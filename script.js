/* ============================================================
   AESF · Banco de Preguntas — Lógica principal
   ============================================================ */

// ============================================================
// CONFIGURACIÓN GLOBAL
// ============================================================
const CONFIG = {
    EXAMEN_REGLAMENTO: 60,
    EXAMEN_ESPECIFICAS: 20,
    MAX_FALLOS_REGLAMENTO: 12,
    MAX_FALLOS_ESPECIFICAS: 7,
    DURACION_EXAMEN_MS: 2 * 60 * 60 * 1000, // 2 horas
    STORAGE_KEYS: {
        THEME: 'aesf_theme',
        FAILS: 'aesf_fails',
        FLAGS: 'aesf_flags',
        RECORD_SD: 'aesf_record_sd',
        HISTORY: 'aesf_history',
        DOMINADAS: 'aesf_dominadas',
        SEEN: 'aesf_seen',
        SETTINGS: 'aesf_settings',
        PLAN: 'aesf_plan',
        PLAN_PROGRESS: 'aesf_plan_progress',
        SESION_ACTIVA: 'aesf_sesion_activa',  // {q, opciones, examenInicio, modo} para recuperar
    }
};

// Orden preferido de temas (para que aparezcan ordenados aunque no estén alfabéticos)
const ORDEN_TEMAS = {
    reglamento: ['Libro 1', 'Libro 2', 'Libro 3', 'Libro 4', 'Libro 5 ASFA', 'Libro 5 sin ATP'],
    especifica: ['Freno', 'Rodante', 'Infraestructura', 'Legislación', 'Eléctrico', 'Diésel', 'PRL']
};

// ============================================================
// ESTADO GLOBAL
// ============================================================
const state = {
    preguntas: [],              // banco completo cargado del JSON
    temasDisponibles: {         // {reglamento: [{nombre, count}], especifica: [...]}
        reglamento: [],
        especifica: []
    },
    modo: null,                 // 'examen-oficial', 'practica', etc.
    quiz: null,                 // estado de la sesión actual de preguntas
    timerId: null,
    timerEnd: null,
    examenInicio: null,         // timestamp inicio de la sesión actual
    timeoutRecordatorio: null,  // setTimeout id para el aviso del plan
};

// ============================================================
// UTILIDADES
// ============================================================
function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function sample(arr, n) {
    return shuffle(arr).slice(0, n);
}

// ============================================================
// CONFETTI (celebración al aprobar)
// ============================================================
function lanzarConfetti(duracionMs = 3500) {
    const canvas = $('#confetti-canvas');
    if (!canvas) return;
    canvas.classList.add('is-active');

    const W = canvas.width = window.innerWidth;
    const H = canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');

    const colores = ['#00d97e', '#9ed500', '#ffb547', '#a78bfa', '#5cb8ff', '#ff5470', '#ffffff'];
    const particulas = [];
    const NUM = 180;

    for (let i = 0; i < NUM; i++) {
        particulas.push({
            x: W / 2 + (Math.random() - 0.5) * 200,
            y: H * 0.35 + (Math.random() - 0.5) * 80,
            vx: (Math.random() - 0.5) * 14,
            vy: -Math.random() * 16 - 6,
            ax: 0,
            ay: 0.35,             // gravedad
            tam: 4 + Math.random() * 6,
            color: colores[Math.floor(Math.random() * colores.length)],
            rot: Math.random() * Math.PI * 2,
            vrot: (Math.random() - 0.5) * 0.3,
            forma: Math.random() < 0.5 ? 'rect' : 'circ',
            vida: 1,
        });
    }

    const tInicio = performance.now();

    function frame(t) {
        const transcurrido = t - tInicio;
        ctx.clearRect(0, 0, W, H);

        particulas.forEach(p => {
            p.vx += p.ax;
            p.vy += p.ay;
            p.x += p.vx;
            p.y += p.vy;
            p.rot += p.vrot;
            // Resistencia
            p.vx *= 0.985;
            // Empezar a desvanecer hacia el final
            if (transcurrido > duracionMs * 0.6) {
                p.vida = Math.max(0, 1 - (transcurrido - duracionMs * 0.6) / (duracionMs * 0.4));
            }

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.globalAlpha = p.vida;
            ctx.fillStyle = p.color;
            if (p.forma === 'rect') {
                ctx.fillRect(-p.tam / 2, -p.tam / 2, p.tam, p.tam * 0.5);
            } else {
                ctx.beginPath();
                ctx.arc(0, 0, p.tam / 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        });

        if (transcurrido < duracionMs) {
            requestAnimationFrame(frame);
        } else {
            ctx.clearRect(0, 0, W, H);
            canvas.classList.remove('is-active');
        }
    }

    requestAnimationFrame(frame);
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

function fmtTiempo(ms) {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function ordenarTemas(categoria, listaTemas) {
    const orden = ORDEN_TEMAS[categoria] || [];
    return listaTemas.slice().sort((a, b) => {
        const ia = orden.indexOf(a.nombre);
        const ib = orden.indexOf(b.nombre);
        if (ia === -1 && ib === -1) return a.nombre.localeCompare(b.nombre);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
    });
}

// ============================================================
// CARGA INICIAL DEL BANCO
// ============================================================
async function cargarBanco() {
    const status = $('#splash-status');
    const splash = $('#app-splash');
    try {
        if (status) status.textContent = 'Descargando banco de preguntas...';
        const res = await fetch('preguntas.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (status) status.textContent = 'Procesando preguntas...';
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('El JSON está vacío o no es un array.');
        }
        state.preguntas = data;
        if (status) status.textContent = `Listo. ${data.length} preguntas cargadas.`;
        calcularTemasDisponibles();
        actualizarStatsHome();
        actualizarModosDisponibles();
        actualizarHomePlan();
        programarRecordatorioHoy();

        // Ocultar splash con un pequeño retraso para que se note
        setTimeout(() => {
            if (splash) splash.classList.add('is-hiding');
            // Si hay una sesión interrumpida, ofrecer continuarla
            setTimeout(() => ofrecerRestaurarSesion(), 450);
        }, 300);
    } catch (err) {
        console.error('Error cargando preguntas.json:', err);
        if (status) {
            status.innerHTML = `<div class="splash-error">Error al cargar las preguntas.<br>Verifica tu conexión.</div>`;
        }
        // Esperar 2s antes de mostrar la pantalla de error completa
        setTimeout(() => {
            if (splash) splash.classList.add('is-hiding');
            $('#screen-home').hidden = true;
            $('#loading-error').hidden = false;
            $('#error-detail').textContent = `Detalle técnico: ${err.message}`;
        }, 2000);
    }
}

function calcularTemasDisponibles() {
    const grupos = { reglamento: {}, especifica: {} };
    for (const p of state.preguntas) {
        const cat = p.categoria;
        if (!grupos[cat]) continue;
        grupos[cat][p.tema] = (grupos[cat][p.tema] || 0) + 1;
    }
    state.temasDisponibles.reglamento = ordenarTemas('reglamento',
        Object.entries(grupos.reglamento).map(([nombre, count]) => ({ nombre, count })));
    state.temasDisponibles.especifica = ordenarTemas('especifica',
        Object.entries(grupos.especifica).map(([nombre, count]) => ({ nombre, count })));
}

function actualizarStatsHome() {
    const total = state.preguntas.length;
    const reg = state.preguntas.filter(p => p.categoria === 'reglamento').length;
    const esp = state.preguntas.filter(p => p.categoria === 'especifica').length;
    $('#stat-total').textContent = total;
    $('#stat-reg').textContent = reg;
    $('#stat-esp').textContent = esp;

    // Actualizar contador de fallos en la tarjeta de "Repasar fallos"
    const fallos = obtenerFallosGuardados();
    const numFallos = Object.keys(fallos).filter(id => state.preguntas.some(p => p.id === id)).length;
    const fallosTag = $('#fallos-count');
    if (fallosTag) {
        if (numFallos === 0) {
            fallosTag.textContent = 'Sin fallos aún';
        } else {
            fallosTag.textContent = `${numFallos} falladas`;
        }
    }

    // Actualizar contador del botón Buscador
    const cardBuscar = document.querySelector('.mode-card[data-mode="buscar"]');
    if (cardBuscar) {
        const tag = cardBuscar.querySelector('.mode-tag');
        if (tag) tag.textContent = `${total} preguntas`;
    }
}

function actualizarModosDisponibles() {
    // Si no hay preguntas de específicas, deshabilitamos el examen oficial
    const hayReg = state.temasDisponibles.reglamento.length > 0;
    const hayEsp = state.temasDisponibles.especifica.length > 0;

    const cardOficial = $('[data-mode="examen-oficial"]');
    if (cardOficial && !hayEsp) {
        cardOficial.classList.add('mode-card--disabled');
        cardOficial.disabled = true;
        const tag = cardOficial.querySelector('.mode-tag');
        const desc = cardOficial.querySelector('.mode-desc');
        if (tag) tag.textContent = 'Faltan específicas';
        if (desc) desc.textContent = 'Necesitas preguntas de la categoría "específicas" para generar el examen oficial.';
    }
}

// ============================================================
// TEMA OSCURO/CLARO
// ============================================================
function inicializarTema() {
    const guardado = localStorage.getItem(CONFIG.STORAGE_KEYS.THEME);
    if (guardado === 'light' || guardado === 'dark') {
        document.body.dataset.theme = guardado;
    }
    $('#theme-toggle').addEventListener('click', () => {
        const actual = document.body.dataset.theme;
        const nuevo = actual === 'dark' ? 'light' : 'dark';
        document.body.dataset.theme = nuevo;
        localStorage.setItem(CONFIG.STORAGE_KEYS.THEME, nuevo);
    });
}

// ============================================================
// NAVEGACIÓN ENTRE PANTALLAS
// ============================================================
function mostrarPantalla(nombre) {
    $$('.screen').forEach(s => s.hidden = true);
    const target = $(`#screen-${nombre}`);
    if (target) target.hidden = false;
    window.scrollTo({ top: 0, behavior: 'instant' });
}

function irAHome() {
    pararTemporizador();
    ocultarTimer();
    $('#floating-counter').hidden = true;
    $('#btn-review-answers').style.display = '';

    // Si había una sesión de práctica activa con respuestas, guardarla en historial
    if (state.quiz && !state.quiz.finalizado && state.quiz.modoQuiz !== 'examen') {
        registrarSesionEnHistorial(state.quiz);
    }

    // Limpiar la sesión guardada (ya no hay nada que restaurar)
    borrarSesionActiva();

    state.modo = null;
    state.quiz = null;
    actualizarStatsHome();
    actualizarHomePlan();
    mostrarPantalla('home');
}

// ============================================================
// PANTALLA DE CONFIGURACIÓN
// ============================================================
function abrirConfiguracion(modo) {
    state.modo = modo;

    // Modos con pantalla dedicada
    if (modo === 'buscar') {
        abrirBuscador();
        return;
    }
    if (modo === 'pdf') {
        abrirGeneradorPDF();
        return;
    }
    if (modo === 'repasar-fallos') {
        comenzarRepasoFallos();
        return;
    }

    const titulos = {
        'examen-oficial': 'Examen oficial AESF',
        'examen-personalizado': 'Examen personalizado',
        'practica': 'Práctica por tema',
        'infinitas': 'Preguntas infinitas',
        'repaso-rapido': 'Repaso rápido',
        'muerte-subita': 'Muerte súbita',
        'smart-study': 'Smart Study',
    };
    const descripciones = {
        'examen-oficial': '60 preguntas de reglamento + 20 de específicas. 2 horas. Corrección al final.',
        'examen-personalizado': 'Configura qué temas entran en cada categoría. Mismo formato que el oficial.',
        'practica': 'Elige uno o varios temas. Corrección al instante, sin temporizador.',
        'infinitas': 'Preguntas aleatorias de todos los temas seleccionados, sin fin.',
        'repaso-rapido': 'Verás la pregunta y la respuesta correcta. Para memorizar rápido.',
        'muerte-subita': 'Falla una y se acaba. Tu racha máxima se guardará como récord.',
        'smart-study': 'Combina tus fallos recientes, preguntas que nunca has visto y algunas aleatorias. Estudio optimizado.',
    };

    $('#config-title').textContent = titulos[modo] || 'Configurar';
    $('#config-desc').textContent = descripciones[modo] || '';

    const content = $('#config-content');
    content.innerHTML = '';

    if (modo === 'examen-oficial') {
        renderExamenOficialConfig(content);
    } else if (modo === 'examen-personalizado') {
        renderExamenPersonalizadoConfig(content);
    } else if (modo === 'muerte-subita') {
        renderMuerteSubitaConfig(content);
    } else if (modo === 'smart-study') {
        renderSmartStudyConfig(content);
    } else if (modo === 'practica' || modo === 'infinitas' || modo === 'repaso-rapido') {
        renderSeleccionTemasConfig(content, modo);
    }

    mostrarPantalla('config');
}

function renderExamenOficialConfig(content) {
    const totalReg = state.preguntas.filter(p => p.categoria === 'reglamento').length;
    const totalEsp = state.preguntas.filter(p => p.categoria === 'especifica').length;

    const okReg = totalReg >= CONFIG.EXAMEN_REGLAMENTO;
    const okEsp = totalEsp >= CONFIG.EXAMEN_ESPECIFICAS;

    let html = `
        <div class="config-info">
            El examen seleccionará aleatoriamente <strong>${CONFIG.EXAMEN_REGLAMENTO} preguntas de reglamento</strong>
            y <strong>${CONFIG.EXAMEN_ESPECIFICAS} de específicas</strong> del banco completo.
            Para considerarse <strong>APTO</strong> no puedes fallar más de
            <strong>${CONFIG.MAX_FALLOS_REGLAMENTO} de reglamento</strong> ni
            <strong>${CONFIG.MAX_FALLOS_ESPECIFICAS} de específicas</strong>.
        </div>
    `;

    if (!okReg || !okEsp) {
        html += `<div class="config-warn">
            <strong>Atención:</strong> el banco aún no tiene suficientes preguntas.
            Reglamento: ${totalReg}/${CONFIG.EXAMEN_REGLAMENTO}. Específicas: ${totalEsp}/${CONFIG.EXAMEN_ESPECIFICAS}.
        </div>`;
    }

    content.innerHTML = html;
    $('#btn-start').disabled = !(okReg && okEsp);
    $('#btn-start').textContent = okReg && okEsp ? 'Comenzar examen' : 'Aún no es posible';
}

function renderExamenPersonalizadoConfig(content) {
    const temasReg = state.temasDisponibles.reglamento;
    const temasEsp = state.temasDisponibles.especifica;

    let html = `
        <div class="config-info">
            Elige qué temas entran en cada categoría. El examen tendrá
            <strong>${CONFIG.EXAMEN_REGLAMENTO} + ${CONFIG.EXAMEN_ESPECIFICAS} preguntas</strong>
            tomadas aleatoriamente de tu selección.
        </div>
    `;

    if (temasReg.length > 0) {
        html += renderSeccionTemas('Reglamento', 'reg', temasReg);
    }
    if (temasEsp.length > 0) {
        html += renderSeccionTemas('Específicas', 'esp', temasEsp);
    }

    content.innerHTML = html;
    cablearSelectoresTemas();
    $('#btn-start').textContent = 'Comenzar examen';
    actualizarBotonStartExamenPersonalizado();
}

function renderSeleccionTemasConfig(content, modo) {
    const temasReg = state.temasDisponibles.reglamento;
    const temasEsp = state.temasDisponibles.especifica;

    let html = '';

    if (temasReg.length > 0) {
        html += renderSeccionTemas('Reglamento', 'reg', temasReg);
    }
    if (temasEsp.length > 0) {
        html += renderSeccionTemas('Específicas', 'esp', temasEsp);
    }

    // Para "infinitas" añadimos opción de orden
    if (modo === 'infinitas') {
        html += `
            <div class="config-section">
                <div class="config-section-label"><span>Aviso</span></div>
                <div class="config-info">
                    Al acertar/fallar verás la respuesta y pasarás a la siguiente.
                    Pulsa <strong>Inicio</strong> para terminar cuando quieras.
                </div>
            </div>
        `;
    }

    content.innerHTML = html;
    cablearSelectoresTemas();
    $('#btn-start').textContent = 'Comenzar';
    actualizarBotonStartPorTemas();
}

function renderMuerteSubitaConfig(content) {
    const temasReg = state.temasDisponibles.reglamento;
    const temasEsp = state.temasDisponibles.especifica;
    const record = obtenerRecordSD();

    let html = '';
    if (record.racha > 0) {
        const fecha = new Date(record.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
        html += `<div class="record-bar">
            <span class="record-bar-label">🏆 Tu récord actual</span>
            <span class="record-bar-value">${record.racha} aciertos seguidos <span style="color:var(--text-3); font-weight:400; font-size:13px;">· ${fecha}</span></span>
        </div>`;
    }

    html += `<div class="config-info">
        Falla <strong>una sola pregunta</strong> y se acabó. Pulsa <strong>Terminar</strong> cuando quieras parar.
        Tu mejor racha se guardará automáticamente.
    </div>`;

    if (temasReg.length > 0) {
        html += renderSeccionTemas('Reglamento', 'reg', temasReg);
    }
    if (temasEsp.length > 0) {
        html += renderSeccionTemas('Específicas', 'esp', temasEsp);
    }

    content.innerHTML = html;
    cablearSelectoresTemas();
    actualizarBotonStartPorTemas();
}

function renderSmartStudyConfig(content) {
    const temasReg = state.temasDisponibles.reglamento;
    const temasEsp = state.temasDisponibles.especifica;
    const fallos = obtenerFallosGuardados();
    const dominadas = obtenerDominadas();
    const vistas = obtenerVistas();

    const numFallos = Object.keys(fallos).filter(id => state.preguntas.some(p => p.id === id && !dominadas[id])).length;
    const numDominadas = Object.keys(dominadas).filter(id => state.preguntas.some(p => p.id === id)).length;
    const numNuevas = state.preguntas.filter(p => !vistas[p.id] && !dominadas[p.id]).length;

    let html = `<div class="config-info">
        <strong>¿Cómo funciona?</strong><br>
        Smart Study mezcla:<br>
        · <strong>60%</strong> de tus fallos recientes (priorizamos lo que más te cuesta)<br>
        · <strong>30%</strong> de preguntas que nunca has visto<br>
        · <strong>10%</strong> aleatorias de todo el banco<br>
        Las preguntas marcadas como <strong>"ya las domino"</strong> quedan excluidas.
    </div>`;

    html += `<div class="config-mini-grid" style="margin-bottom: 24px;">
        <div class="config-mini-field">
            <label>Fallos pendientes</label>
            <input type="text" value="${numFallos}" readonly style="color: var(--danger);">
        </div>
        <div class="config-mini-field">
            <label>Nunca vistas</label>
            <input type="text" value="${numNuevas}" readonly style="color: var(--flag);">
        </div>
        <div class="config-mini-field">
            <label>Dominadas</label>
            <input type="text" value="${numDominadas}" readonly style="color: var(--accent);">
        </div>
    </div>`;

    html += `<div class="config-section">
        <div class="config-section-label"><span>Tamaño de la sesión</span></div>
        <div class="config-mini-grid">
            <div class="config-mini-field">
                <label>Nº preguntas</label>
                <select id="smart-size" style="width:100%; background:transparent; border:none; color:var(--text); font-size:18px; font-weight:600; outline:none;">
                    <option value="10">10</option>
                    <option value="20" selected>20</option>
                    <option value="40">40</option>
                    <option value="80">80</option>
                </select>
            </div>
        </div>
    </div>`;

    if (temasReg.length > 0) {
        html += renderSeccionTemas('Reglamento', 'reg', temasReg);
    }
    if (temasEsp.length > 0) {
        html += renderSeccionTemas('Específicas', 'esp', temasEsp);
    }

    content.innerHTML = html;
    cablearSelectoresTemas();
    actualizarBotonStartPorTemas();
}

function generarMezclaSmartStudy(temasReg, temasEsp, tamano) {
    const fallos = obtenerFallosGuardados();
    const dominadas = obtenerDominadas();
    const vistas = obtenerVistas();

    // Pool filtrado por temas y excluyendo dominadas
    const pool = state.preguntas.filter(p =>
        !dominadas[p.id] &&
        ((p.categoria === 'reglamento' && temasReg.includes(p.tema)) ||
         (p.categoria === 'especifica' && temasEsp.includes(p.tema)))
    );

    // Separar en grupos
    const grupoFallos = pool.filter(p => fallos[p.id])
                            .sort((a, b) => (fallos[b.id] || 0) - (fallos[a.id] || 0)); // más recientes primero
    const grupoNuevas = pool.filter(p => !vistas[p.id] && !fallos[p.id]);
    const grupoOtras = pool.filter(p => vistas[p.id] && !fallos[p.id]);

    // Cantidades objetivo
    let nFallos = Math.floor(tamano * 0.6);
    let nNuevas = Math.floor(tamano * 0.3);
    let nOtras = tamano - nFallos - nNuevas;

    // Si no hay suficientes, redistribuir
    if (grupoFallos.length < nFallos) {
        const sobran = nFallos - grupoFallos.length;
        nFallos = grupoFallos.length;
        nNuevas += sobran;
    }
    if (grupoNuevas.length < nNuevas) {
        const sobran = nNuevas - grupoNuevas.length;
        nNuevas = grupoNuevas.length;
        nOtras += sobran;
    }
    if (grupoOtras.length < nOtras) {
        nOtras = grupoOtras.length;
    }

    const seleccion = [
        ...grupoFallos.slice(0, nFallos),
        ...sample(grupoNuevas, nNuevas),
        ...sample(grupoOtras, nOtras)
    ];

    return shuffle(seleccion);
}

function obtenerRecordSD() {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.RECORD_SD);
        return raw ? JSON.parse(raw) : { racha: 0, fecha: 0 };
    } catch (e) {
        return { racha: 0, fecha: 0 };
    }
}

function guardarRecordSD(racha) {
    const actual = obtenerRecordSD();
    if (racha > actual.racha) {
        localStorage.setItem(CONFIG.STORAGE_KEYS.RECORD_SD, JSON.stringify({ racha, fecha: Date.now() }));
        return true; // nuevo récord
    }
    return false;
}

function obtenerFallosGuardados() {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.FAILS);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function eliminarFallo(idPregunta) {
    const fallos = obtenerFallosGuardados();
    delete fallos[idPregunta];
    localStorage.setItem(CONFIG.STORAGE_KEYS.FAILS, JSON.stringify(fallos));
}

// -------- Historial de exámenes --------
function obtenerHistorial() {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.HISTORY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function guardarExamenEnHistorial(entrada) {
    const hist = obtenerHistorial();
    hist.unshift(entrada);          // más reciente primero
    const limitado = hist.slice(0, 50);  // guardar máx 50
    try {
        localStorage.setItem(CONFIG.STORAGE_KEYS.HISTORY, JSON.stringify(limitado));
    } catch (e) { console.warn('No se pudo guardar historial', e); }
}

function registrarSesionEnHistorial(q, datosExtra = {}) {
    // Para sesiones que NO sean examen oficial (smart study, práctica, muerte súbita, infinitas).
    // El examen oficial usa guardarExamenEnHistorial directamente.
    let aciertos = 0, fallos = 0;
    q.preguntas.forEach(p => {
        const resp = q.respuestas?.[p.id];
        if (resp === undefined) return; // no contestada (en prácticas se cuenta solo lo respondido)
        if (resp === p.respuesta_correcta) aciertos++;
        else fallos++;
    });
    const total = aciertos + fallos;
    if (total === 0) return; // no guardar sesiones vacías

    const duracion = state.examenInicio ? (Date.now() - state.examenInicio) : null;
    guardarExamenEnHistorial({
        fecha: Date.now(),
        etiqueta: q.etiqueta || 'Sesión',
        modo: q.modoQuiz === 'examen' ? 'examen' : 'practica',
        total,
        aciertos,
        fallosReg: 0,
        fallosEsp: 0,
        aciertosReg: 0,
        aciertosEsp: 0,
        sinResponder: q.preguntas.length - total,
        apto: null,
        duracion,
        ...datosExtra,
    });
}

function borrarHistorial() {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.HISTORY);
}

// -------- Preguntas dominadas (marcadas como "ya las sé") --------
function obtenerDominadas() {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.DOMINADAS);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

function marcarDominada(idPregunta) {
    const d = obtenerDominadas();
    d[idPregunta] = Date.now();
    localStorage.setItem(CONFIG.STORAGE_KEYS.DOMINADAS, JSON.stringify(d));
    // Al marcar como dominada, eliminamos de fallos también
    eliminarFallo(idPregunta);
}

function desmarcarDominada(idPregunta) {
    const d = obtenerDominadas();
    delete d[idPregunta];
    localStorage.setItem(CONFIG.STORAGE_KEYS.DOMINADAS, JSON.stringify(d));
}

function borrarDominadas() {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.DOMINADAS);
}

// -------- Vistas (cuántas veces se ha visto cada pregunta) --------
function obtenerVistas() {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.SEEN);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

function incrementarVista(idPregunta) {
    const s = obtenerVistas();
    s[idPregunta] = (s[idPregunta] || 0) + 1;
    try {
        localStorage.setItem(CONFIG.STORAGE_KEYS.SEEN, JSON.stringify(s));
    } catch (e) { /* silencioso */ }
}

function borrarVistas() {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.SEEN);
}

// -------- Settings --------
function obtenerSettings() {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS);
        return raw ? JSON.parse(raw) : { voice: '', rate: 1, pitch: 1, installDismissed: false };
    } catch (e) { return { voice: '', rate: 1, pitch: 1, installDismissed: false }; }
}

function guardarSettings(s) {
    localStorage.setItem(CONFIG.STORAGE_KEYS.SETTINGS, JSON.stringify(s));
}

// ============================================================
// SESIÓN ACTIVA (anti-pérdida por refresh / cierre accidental)
// ============================================================
function guardarSesionActiva() {
    if (!state.quiz || state.quiz.finalizado) return;
    const q = state.quiz;
    // Solo guardamos sesiones con respuestas o exámenes con timer (donde sí importa)
    const tieneRespuestas = q.respuestas && Object.keys(q.respuestas).length > 0;
    const tieneCorregidas = q.corregidas && Object.keys(q.corregidas).length > 0;
    if (!tieneRespuestas && !tieneCorregidas && q.aciertos === 0 && q.fallos === 0) {
        // Sesión sin progreso, no guardar
        return;
    }
    const snapshot = {
        // Solo guardamos lo necesario para reconstruir
        preguntasIds: q.preguntas.map(p => p.id),
        modoQuiz: q.modoQuiz,
        navegableLibre: q.navegableLibre,
        corregirAlInstante: q.corregirAlInstante,
        mostrarBanderitas: q.mostrarBanderitas,
        etiqueta: q.etiqueta,
        conTimer: q.conTimer,
        respuestas: q.respuestas || {},
        corregidas: q.corregidas || {},
        banderitas: Array.from(q.banderitas || []),
        indice: q.indice,
        aciertos: q.aciertos || 0,
        fallos: q.fallos || 0,
        racha: q.racha || 0,
        rachaMaxima: q.rachaMaxima || 0,
        usadasInfinitas: Array.from(q.usadasInfinitas || []),
        // Timer
        examenInicio: state.examenInicio,
        timerEnd: state.timerEnd,
        // Cuándo se guardó
        guardadoEn: Date.now(),
    };
    try {
        localStorage.setItem(CONFIG.STORAGE_KEYS.SESION_ACTIVA, JSON.stringify(snapshot));
    } catch (e) {
        console.warn('No se pudo guardar la sesión activa:', e);
    }
}

function obtenerSesionActiva() {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.SESION_ACTIVA);
        if (!raw) return null;
        const s = JSON.parse(raw);
        // Sesiones de más de 24h se descartan automáticamente
        if (Date.now() - s.guardadoEn > 24 * 3600 * 1000) {
            borrarSesionActiva();
            return null;
        }
        return s;
    } catch (e) {
        return null;
    }
}

function borrarSesionActiva() {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.SESION_ACTIVA);
}

function restaurarSesion(snapshot) {
    // Reconstruir el quiz a partir del snapshot
    const preguntas = snapshot.preguntasIds
        .map(id => state.preguntas.find(p => p.id === id))
        .filter(Boolean);

    if (preguntas.length === 0) {
        borrarSesionActiva();
        return false;
    }

    state.examenInicio = snapshot.examenInicio;

    state.quiz = {
        preguntas,
        pool: preguntas.slice(),
        modoQuiz: snapshot.modoQuiz,
        navegableLibre: snapshot.navegableLibre,
        corregirAlInstante: snapshot.corregirAlInstante,
        mostrarBanderitas: snapshot.mostrarBanderitas,
        etiqueta: snapshot.etiqueta,
        respuestas: snapshot.respuestas || {},
        corregidas: snapshot.corregidas || {},
        banderitas: new Set(snapshot.banderitas || []),
        indice: snapshot.indice || 0,
        finalizado: false,
        conTimer: snapshot.conTimer,
        aciertos: snapshot.aciertos || 0,
        fallos: snapshot.fallos || 0,
        racha: snapshot.racha || 0,
        rachaMaxima: snapshot.rachaMaxima || 0,
        usadasInfinitas: new Set(snapshot.usadasInfinitas || []),
    };

    mostrarPantalla('quiz');

    // Layout
    const nav = $('#quiz-nav');
    const navMobileBtn = $('#nav-mobile-toggle');
    const layout = document.querySelector('.quiz-layout');
    if (snapshot.navegableLibre) {
        nav.style.display = '';
        navMobileBtn.style.display = '';
        layout.classList.remove('no-nav');
    } else {
        nav.style.display = 'none';
        navMobileBtn.style.display = 'none';
        layout.classList.add('no-nav');
    }

    $('#btn-finish').hidden = (snapshot.modoQuiz !== 'examen');

    // Timer si era examen
    if (snapshot.conTimer && snapshot.timerEnd) {
        const tiempoRestante = snapshot.timerEnd - Date.now();
        if (tiempoRestante > 0) {
            state.timerEnd = snapshot.timerEnd;
            const timerEl = $('#exam-timer');
            timerEl.hidden = false;
            timerEl.classList.remove('warn', 'danger');
            actualizarTemporizador();
            state.timerId = setInterval(actualizarTemporizador, 1000);
        } else {
            // El tiempo ya se agotó, finalizar examen directamente
            borrarSesionActiva();
            setTimeout(() => finalizarExamen(true), 100);
            return true;
        }
    }

    // Contador flotante en modos infinitos
    if (snapshot.modoQuiz === 'infinitas' || snapshot.modoQuiz === 'muerte-subita') {
        $('#floating-counter').hidden = false;
        actualizarContadorFlotante();
    }

    renderQuiz();
    if (snapshot.navegableLibre) renderNavLateral();
    return true;
}

function ofrecerRestaurarSesion() {
    const snapshot = obtenerSesionActiva();
    if (!snapshot) return false;

    // Construir info de la sesión
    const numRespondidas = Object.keys(snapshot.respuestas || {}).length;
    const numCorregidas = Object.keys(snapshot.corregidas || {}).length;
    const progreso = Math.max(numRespondidas, numCorregidas, snapshot.indice + 1);
    const total = snapshot.preguntasIds.length;
    const minutosAtrás = Math.round((Date.now() - snapshot.guardadoEn) / 60000);
    const tiempoStr = minutosAtrás < 1 ? 'hace menos de un minuto' :
                      minutosAtrás < 60 ? `hace ${minutosAtrás} min` :
                      `hace ${Math.round(minutosAtrás / 60)} h`;

    $('#confirm-title').textContent = 'Continuar sesión anterior';
    $('#confirm-message').innerHTML = `Tienes una sesión sin terminar:<br><br>
        <strong>${escapeHtml(snapshot.etiqueta || 'Sesión')}</strong><br>
        <span style="font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--text-3);">
        ${progreso} de ${total} preguntas · interrumpida ${tiempoStr}
        </span><br><br>¿Quieres continuar donde lo dejaste?`;
    $('#confirm-yes').textContent = 'Continuar';
    $('#confirm-no').textContent = 'Empezar de nuevo';
    $('#confirm-modal').hidden = false;

    const yes = $('#confirm-yes');
    const newYes = yes.cloneNode(true);
    yes.parentNode.replaceChild(newYes, yes);
    newYes.addEventListener('click', () => {
        $('#confirm-modal').hidden = true;
        $('#confirm-yes').textContent = 'Sí, finalizar';
        $('#confirm-no').textContent = 'Cancelar';
        restaurarSesion(snapshot);
        cablearConfirmGenerico();
    });

    const no = $('#confirm-no');
    const newNo = no.cloneNode(true);
    no.parentNode.replaceChild(newNo, no);
    newNo.addEventListener('click', () => {
        $('#confirm-modal').hidden = true;
        $('#confirm-yes').textContent = 'Sí, finalizar';
        $('#confirm-no').textContent = 'Cancelar';
        borrarSesionActiva();
        cablearConfirmGenerico();
    });

    return true;
}

// ============================================================
// PLAN DE ESTUDIO
// ============================================================
function obtenerPlan() {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.PLAN);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function guardarPlan(plan) {
    localStorage.setItem(CONFIG.STORAGE_KEYS.PLAN, JSON.stringify(plan));
}

function borrarPlan() {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.PLAN);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.PLAN_PROGRESS);
}

function obtenerProgresoPlan() {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.PLAN_PROGRESS);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

function marcarDiaCompletado(fechaISO) {
    const p = obtenerProgresoPlan();
    p[fechaISO] = { completado: Date.now() };
    localStorage.setItem(CONFIG.STORAGE_KEYS.PLAN_PROGRESS, JSON.stringify(p));
}

function desmarcarDia(fechaISO) {
    const p = obtenerProgresoPlan();
    delete p[fechaISO];
    localStorage.setItem(CONFIG.STORAGE_KEYS.PLAN_PROGRESS, JSON.stringify(p));
}

function fechaISO(d) {
    // YYYY-MM-DD en zona local
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function diasEntre(d1, d2) {
    const ms = 1000 * 60 * 60 * 24;
    const a = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const b = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
    return Math.round((b - a) / ms);
}

function generarPlanEstudio(fechaExamen, intensidad, hora) {
    // intensidad: 'baja' (1 actividad/día max 5 días), 'media' (2 actividad/día, todos los días), 'alta' (2 actividad/día + bloques largos)
    // Genera array de días con [{ fecha: 'YYYY-MM-DD', diaSemana, actividades: [{tipo, titulo, descripcion, modo, params}] }]
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const examen = new Date(fechaExamen); examen.setHours(0,0,0,0);
    const totalDias = diasEntre(hoy, examen);
    if (totalDias < 1) return [];

    // Temas a rotar
    const temasReg = state.temasDisponibles.reglamento.map(t => t.nombre);
    const temasEsp = state.temasDisponibles.especifica.map(t => t.nombre);
    const todosTemas = [...temasReg, ...temasEsp];

    const dias = [];
    let temaIdx = 0;
    let diasDesdeSimulacro = 0;

    for (let i = 0; i < totalDias; i++) {
        const d = new Date(hoy);
        d.setDate(d.getDate() + i);
        const diaSemana = d.getDay(); // 0 dom, 6 sab
        const fecha = fechaISO(d);
        const diasHastaExamen = totalDias - i;
        const actividades = [];

        // Última semana antes del examen: SOLO repasos y simulacros
        const esUltimaSemana = (diasHastaExamen <= 7);
        const esDiaAntes = (diasHastaExamen === 1);
        const esDiaExamen = (diasHastaExamen === 0);

        if (esDiaExamen) {
            actividades.push({
                tipo: 'examen-dia',
                titulo: '🎯 Día del examen',
                descripcion: '¡Suerte! Descansa, desayuna bien y confía en tu preparación.',
                modo: null
            });
        } else if (esDiaAntes) {
            actividades.push({
                tipo: 'repaso',
                titulo: 'Repaso ligero',
                descripcion: 'Revisa tus banderitas y dudas más recientes. Sin presión.',
                modo: 'practica-fallos'
            });
            actividades.push({
                tipo: 'descanso',
                titulo: 'Descanso',
                descripcion: 'No estudies más. Mañana necesitas la cabeza fresca.',
                modo: null
            });
        } else if (esUltimaSemana) {
            // Última semana: simulacros y fallos
            if (diasHastaExamen === 7 || diasHastaExamen === 5 || diasHastaExamen === 3) {
                actividades.push({
                    tipo: 'simulacro',
                    titulo: 'Simulacro completo',
                    descripcion: '60 reglamento + 20 específicas. 2 horas con cronómetro.',
                    modo: 'examen-oficial'
                });
            } else {
                actividades.push({
                    tipo: 'repaso',
                    titulo: 'Repasa tus fallos',
                    descripcion: 'Las preguntas que has fallado anteriormente.',
                    modo: 'practica-fallos'
                });
            }
            if (intensidad !== 'baja') {
                actividades.push({
                    tipo: 'smart',
                    titulo: 'Smart Study (20 preguntas)',
                    descripcion: 'Mezcla adaptativa: fallos + nuevas + aleatorias.',
                    modo: 'smart-study'
                });
            }
        } else {
            // Rutina normal
            // Domingo: simulacro semanal (si han pasado >= 6 días)
            if (diaSemana === 0 && diasDesdeSimulacro >= 5) {
                actividades.push({
                    tipo: 'simulacro',
                    titulo: 'Simulacro semanal',
                    descripcion: '60 reglamento + 20 específicas. 2 horas con cronómetro.',
                    modo: 'examen-oficial'
                });
                diasDesdeSimulacro = 0;
            } else {
                diasDesdeSimulacro++;
                // Tema rotativo
                const tema = todosTemas[temaIdx % todosTemas.length];
                temaIdx++;
                const intensidadCfg = {
                    baja: { saltarCadaDias: 2, numPracticas: 20 },
                    media: { saltarCadaDias: 1, numPracticas: 30 },
                    alta: { saltarCadaDias: 1, numPracticas: 40 },
                };
                const cfg = intensidadCfg[intensidad] || intensidadCfg.media;

                // Para intensidad baja, descansar algunos días
                if (intensidad === 'baja' && i % cfg.saltarCadaDias !== 0) {
                    actividades.push({
                        tipo: 'descanso',
                        titulo: 'Día de descanso',
                        descripcion: 'No estudies hoy. Descansar también es entrenar.',
                        modo: null
                    });
                } else {
                    actividades.push({
                        tipo: 'tema',
                        titulo: `${tema}`,
                        descripcion: `Practica preguntas de "${tema}" sin temporizador.`,
                        modo: 'practica',
                        params: { tema }
                    });

                    if (intensidad === 'alta') {
                        const tema2 = todosTemas[temaIdx % todosTemas.length];
                        temaIdx++;
                        actividades.push({
                            tipo: 'tema',
                            titulo: `${tema2}`,
                            descripcion: `Segunda sesión: práctica del tema "${tema2}".`,
                            modo: 'practica',
                            params: { tema: tema2 }
                        });
                    }

                    // Día de repaso fallos (martes y viernes en intensidad media/alta)
                    if (intensidad !== 'baja' && (diaSemana === 2 || diaSemana === 5)) {
                        actividades.push({
                            tipo: 'repaso',
                            titulo: 'Repasa tus fallos',
                            descripcion: 'Repaso rápido de preguntas falladas.',
                            modo: 'practica-fallos'
                        });
                    }
                }
            }
        }

        dias.push({
            fecha,
            diaSemana,
            diasHastaExamen,
            actividades
        });
    }

    return dias;
}

// ============================================================
// NOTIFICACIONES
// ============================================================
function pedirPermisoNotificaciones() {
    return new Promise((resolve) => {
        if (!('Notification' in window)) {
            resolve('not-supported');
            return;
        }
        if (Notification.permission === 'granted') {
            resolve('granted');
            return;
        }
        if (Notification.permission === 'denied') {
            resolve('denied');
            return;
        }
        Notification.requestPermission().then(resolve);
    });
}

function programarRecordatorioHoy() {
    // Mira el plan, busca la actividad de hoy, y si no está completada y la hora aún no ha pasado,
    // programa un setTimeout para mostrar la notificación a esa hora.
    // Solo funciona mientras la pestaña/PWA está abierta. Las notificaciones push reales requieren backend.
    if (Notification.permission !== 'granted') return;
    const plan = obtenerPlan();
    if (!plan || !plan.hora) return;

    const hoy = new Date();
    const fechaHoy = fechaISO(hoy);
    const progreso = obtenerProgresoPlan();
    if (progreso[fechaHoy]) return; // ya completado

    const dias = generarPlanEstudio(new Date(plan.fechaExamen), plan.intensidad, plan.hora);
    const diaHoy = dias.find(d => d.fecha === fechaHoy);
    if (!diaHoy) return;

    // Calcular ms hasta la hora deseada (formato 'HH:MM')
    const [h, m] = plan.hora.split(':').map(Number);
    const objetivo = new Date(hoy);
    objetivo.setHours(h, m, 0, 0);
    const ms = objetivo - hoy;
    if (ms <= 0) return; // ya pasó

    // Limpiar timeout anterior
    if (state.timeoutRecordatorio) clearTimeout(state.timeoutRecordatorio);

    state.timeoutRecordatorio = setTimeout(() => {
        // Verificar de nuevo que no se completó
        const prog2 = obtenerProgresoPlan();
        if (prog2[fechaHoy]) return;

        const titulosActividades = diaHoy.actividades.map(a => a.titulo).join(' · ');
        try {
            new Notification('AESF — Hoy toca estudiar', {
                body: titulosActividades,
                icon: 'icons/icon-192.png',
                badge: 'icons/icon-192.png',
                tag: 'aesf-daily-' + fechaHoy,
                requireInteraction: false,
            });
        } catch (e) {
            console.warn('No se pudo mostrar notificación', e);
        }
    }, ms);
}

// ============================================================
// EXPORTAR / IMPORTAR DATOS
// ============================================================
function exportarDatos() {
    const datos = {
        version: 1,
        exportadoEn: new Date().toISOString(),
        appVersion: 'AESF v1.0',
    };
    Object.entries(CONFIG.STORAGE_KEYS).forEach(([key, storageKey]) => {
        const val = localStorage.getItem(storageKey);
        if (val !== null) {
            try {
                datos[key] = JSON.parse(val);
            } catch (e) {
                datos[key] = val; // si no es JSON, guardar como string
            }
        }
    });
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const fecha = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `aesf-respaldo-${fecha}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function importarDatos(jsonText) {
    let datos;
    try {
        datos = JSON.parse(jsonText);
    } catch (e) {
        return { ok: false, error: 'El archivo no es un JSON válido.' };
    }
    if (!datos.version || !datos.exportadoEn) {
        return { ok: false, error: 'No parece un respaldo válido de la app (faltan campos version/exportadoEn).' };
    }

    let restaurados = 0;
    Object.entries(CONFIG.STORAGE_KEYS).forEach(([key, storageKey]) => {
        if (datos[key] !== undefined) {
            const valor = typeof datos[key] === 'string' ? datos[key] : JSON.stringify(datos[key]);
            try {
                localStorage.setItem(storageKey, valor);
                restaurados++;
            } catch (e) {
                console.warn('No se pudo restaurar', key, e);
            }
        }
    });

    return { ok: true, restaurados, fecha: datos.exportadoEn };
}

// ============================================================
// STATS POR FRANJA HORARIA Y DÍA DE LA SEMANA
// ============================================================
function calcularEfectoRepaso() {
    // Para cada pregunta vista, sabemos:
    //   - Cuántas veces se ha visto (vistas[id])
    //   - Si actualmente está marcada como fallada
    // Aproximamos: una pregunta vista N veces y no fallada => acierto.
    // Una vista N veces y fallada => fallo en la última.
    // Esto no es exacto pero da una idea fiable del impacto del repaso.
    const vistas = obtenerVistas();
    const fallos = obtenerFallosGuardados();
    const dominadas = obtenerDominadas();

    const buckets = [
        { label: '1 vez',      min: 1, max: 1,  total: 0, aciertos: 0, preguntas: 0 },
        { label: '2-3 veces',  min: 2, max: 3,  total: 0, aciertos: 0, preguntas: 0 },
        { label: '4-6 veces',  min: 4, max: 6,  total: 0, aciertos: 0, preguntas: 0 },
        { label: '7+ veces',   min: 7, max: 999, total: 0, aciertos: 0, preguntas: 0 },
    ];

    let totalVistas = 0;
    state.preguntas.forEach(p => {
        const n = vistas[p.id] || 0;
        if (n < 1) return;
        const bucket = buckets.find(b => n >= b.min && n <= b.max);
        if (!bucket) return;
        bucket.preguntas++;
        bucket.total++;
        // Consideramos acierto si NO está en fallos actuales (asumimos que la dominas si la has visto y no la fallas)
        // Las marcadas como "dominadas" cuentan como acierto seguro
        if (dominadas[p.id] || !fallos[p.id]) {
            bucket.aciertos++;
        }
        totalVistas++;
    });

    const resultado = {
        buckets: buckets.map(b => ({
            ...b,
            pct: b.total === 0 ? null : Math.round((b.aciertos / b.total) * 100)
        })),
        total: totalVistas,
        insight: null
    };

    // Calcular insight: comparar 1 vez vs 4+ veces
    const una = resultado.buckets[0];
    const muchas = resultado.buckets[2].total > 0 ? resultado.buckets[2] : resultado.buckets[3];
    if (una.pct !== null && muchas.pct !== null && muchas !== una && muchas.total >= 3 && una.total >= 3) {
        const diff = muchas.pct - una.pct;
        if (diff >= 15) {
            resultado.insight = `Las preguntas que has repasado ${muchas.label.toLowerCase()} las aciertas un <strong>${diff} puntos más</strong> que las que solo viste una vez. El repaso funciona.`;
        } else if (diff <= -10) {
            resultado.insight = `Curiosamente, las preguntas que has visto más veces las fallas más. Puede que sean preguntas más difíciles. Considera marcarlas como dominadas una vez las domines.`;
        }
    }

    return resultado;
}

function calcularStatsPorHora() {
    const hist = obtenerHistorial();
    // Agrupar por franja de 2 horas
    const franjas = [
        { label: '00-06', min: 0, max: 6, total: 0, aciertos: 0, sesiones: 0 },
        { label: '06-09', min: 6, max: 9, total: 0, aciertos: 0, sesiones: 0 },
        { label: '09-12', min: 9, max: 12, total: 0, aciertos: 0, sesiones: 0 },
        { label: '12-15', min: 12, max: 15, total: 0, aciertos: 0, sesiones: 0 },
        { label: '15-18', min: 15, max: 18, total: 0, aciertos: 0, sesiones: 0 },
        { label: '18-21', min: 18, max: 21, total: 0, aciertos: 0, sesiones: 0 },
        { label: '21-24', min: 21, max: 24, total: 0, aciertos: 0, sesiones: 0 },
    ];

    hist.forEach(h => {
        if (!h.total) return;
        const hora = new Date(h.fecha).getHours();
        const franja = franjas.find(f => hora >= f.min && hora < f.max);
        if (franja) {
            franja.total += h.total;
            franja.aciertos += h.aciertos || 0;
            franja.sesiones++;
        }
    });

    return franjas.map(f => ({
        ...f,
        pct: f.total === 0 ? null : Math.round((f.aciertos / f.total) * 100)
    }));
}

function calcularStatsPorDiaSemana() {
    const hist = obtenerHistorial();
    const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const stats = dias.map(d => ({ dia: d, total: 0, aciertos: 0, sesiones: 0 }));

    hist.forEach(h => {
        if (!h.total) return;
        const idx = new Date(h.fecha).getDay();
        stats[idx].total += h.total;
        stats[idx].aciertos += h.aciertos || 0;
        stats[idx].sesiones++;
    });

    return stats.map(s => ({
        ...s,
        pct: s.total === 0 ? null : Math.round((s.aciertos / s.total) * 100)
    }));
}

// ============================================================
// PANTALLA DE PLAN DE ESTUDIO
// ============================================================
function abrirPlan() {
    const plan = obtenerPlan();
    if (!plan) {
        renderConfigPlan();
    } else {
        renderPlanActivo();
    }
    mostrarPantalla('plan');
}

function renderConfigPlan() {
    const hoy = new Date();
    const minFecha = fechaISO(new Date(hoy.getTime() + 86400000)); // mínimo: mañana
    const sugerencia = new Date(hoy);
    sugerencia.setDate(sugerencia.getDate() + 30);

    const permiso = ('Notification' in window) ? Notification.permission : 'not-supported';

    const html = `
        <div class="plan-config">
            <div class="plan-config-block">
                <h3>1. ¿Cuándo es tu examen?</h3>
                <p class="settings-block-sub">Selecciona la fecha del examen. Te organizaré los días previos para llegar bien preparado.</p>
                <input type="date" id="plan-fecha" min="${minFecha}" value="${fechaISO(sugerencia)}" class="plan-date-input">
            </div>

            <div class="plan-config-block">
                <h3>2. ¿A qué hora quieres estudiar?</h3>
                <p class="settings-block-sub">Recibirás un recordatorio cada día a esta hora.</p>
                <input type="time" id="plan-hora" value="18:00" class="plan-date-input">
            </div>

            <div class="plan-config-block">
                <h3>3. ¿Con qué intensidad?</h3>
                <p class="settings-block-sub">Elige según el tiempo que puedas dedicarle al día.</p>
                <div class="radio-grid">
                    <label class="radio-card">
                        <input type="radio" name="plan-intensidad" value="baja">
                        <div class="radio-card-title">Baja</div>
                        <div class="radio-card-desc">20-30 min cada 2 días. Para quien tiene poco tiempo.</div>
                    </label>
                    <label class="radio-card">
                        <input type="radio" name="plan-intensidad" value="media" checked>
                        <div class="radio-card-title">Media</div>
                        <div class="radio-card-desc">30-45 min al día. Equilibrado, recomendado.</div>
                    </label>
                    <label class="radio-card">
                        <input type="radio" name="plan-intensidad" value="alta">
                        <div class="radio-card-title">Alta</div>
                        <div class="radio-card-desc">1-2 h al día. Si tienes el examen cerca.</div>
                    </label>
                </div>
            </div>

            <div class="plan-config-block">
                <h3>4. Notificaciones</h3>
                <p class="settings-block-sub">Para recibir el aviso diario en la hora elegida, autoriza las notificaciones del navegador. Si no las quieres, podrás ver el plan igualmente.</p>
                <div class="plan-notif-status" id="plan-notif-status">${renderEstadoNotif(permiso)}</div>
                ${permiso === 'default' ? '<button class="btn-primary" id="plan-pedir-permiso" style="margin-top:12px;">Activar notificaciones</button>' : ''}
            </div>

            <div style="display:flex; gap:10px; margin-top:30px;">
                <button class="btn-primary" id="plan-generar">Generar mi plan</button>
            </div>
        </div>
    `;
    $('#plan-content').innerHTML = html;

    $('#plan-pedir-permiso')?.addEventListener('click', async () => {
        const res = await pedirPermisoNotificaciones();
        $('#plan-notif-status').innerHTML = renderEstadoNotif(res);
        $('#plan-pedir-permiso')?.remove();
    });

    $('#plan-generar')?.addEventListener('click', () => {
        const fecha = $('#plan-fecha').value;
        const hora = $('#plan-hora').value;
        const intensidad = document.querySelector('input[name="plan-intensidad"]:checked')?.value || 'media';
        if (!fecha) { alert('Selecciona una fecha de examen.'); return; }
        if (!hora) { alert('Selecciona una hora de estudio.'); return; }

        const plan = {
            fechaExamen: fecha,
            hora,
            intensidad,
            generadoEn: Date.now(),
        };
        guardarPlan(plan);
        programarRecordatorioHoy();
        renderPlanActivo();
    });
}

function renderEstadoNotif(permiso) {
    if (permiso === 'granted') {
        return '<span class="notif-status notif-status--ok">✓ Autorizadas — recibirás recordatorios</span>';
    } else if (permiso === 'denied') {
        return '<span class="notif-status notif-status--ko">✗ Denegadas — actívalas en los ajustes del navegador si las quieres</span>';
    } else if (permiso === 'not-supported') {
        return '<span class="notif-status notif-status--warn">⚠ Tu navegador no soporta notificaciones</span>';
    }
    return '<span class="notif-status notif-status--warn">Pendiente — autoriza para recibir recordatorios</span>';
}

function renderPlanActivo() {
    const plan = obtenerPlan();
    if (!plan) {
        renderConfigPlan();
        return;
    }

    const fechaExamen = new Date(plan.fechaExamen);
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const diasFaltan = diasEntre(hoy, fechaExamen);

    if (diasFaltan < 0) {
        // Examen ya pasó
        $('#plan-content').innerHTML = `
            <div class="plan-finished">
                <h3>El examen ya pasó</h3>
                <p>¡Esperamos que te haya ido bien! Tu plan terminó el ${fechaExamen.toLocaleDateString('es-ES')}.</p>
                <button class="btn-primary" id="plan-reset">Crear un nuevo plan</button>
            </div>
        `;
        $('#plan-reset')?.addEventListener('click', () => {
            borrarPlan();
            renderConfigPlan();
        });
        return;
    }

    const dias = generarPlanEstudio(fechaExamen, plan.intensidad, plan.hora);
    const progreso = obtenerProgresoPlan();
    const intensidadLbl = { baja: 'Baja', media: 'Media', alta: 'Alta' }[plan.intensidad] || plan.intensidad;
    const fechaHoyISO = fechaISO(hoy);

    let html = `
        <div class="plan-active-header">
            <div class="plan-countdown">
                <span class="plan-countdown-num">${diasFaltan}</span>
                <span class="plan-countdown-label">${diasFaltan === 1 ? 'día' : 'días'} para el examen</span>
            </div>
            <div class="plan-meta">
                <div><strong>Examen:</strong> ${fechaExamen.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
                <div><strong>Hora de estudio:</strong> ${plan.hora}</div>
                <div><strong>Intensidad:</strong> ${intensidadLbl}</div>
            </div>
            <button class="settings-action-btn danger" id="plan-eliminar">Eliminar plan</button>
        </div>

        <div class="plan-grid">`;

    dias.forEach(d => {
        const fecha = new Date(d.fecha);
        const esHoy = (d.fecha === fechaHoyISO);
        const completado = !!progreso[d.fecha];
        const pasado = (fecha < hoy);
        const dia = fecha.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });

        let estado = 'futuro';
        if (esHoy) estado = 'hoy';
        else if (pasado) estado = completado ? 'completado' : 'perdido';

        html += `<div class="plan-day plan-day--${estado}" data-fecha="${d.fecha}">
            <div class="plan-day-head">
                <div class="plan-day-date">${dia}${esHoy ? ' · Hoy' : ''}</div>
                ${completado ? '<span class="plan-day-tick">✓</span>' : ''}
            </div>
            <div class="plan-day-activities">`;
        d.actividades.forEach(a => {
            const iconos = { simulacro: '⏱', tema: '📖', repaso: '🔄', smart: '★', descanso: '☕', 'examen-dia': '🎯' };
            const icono = iconos[a.tipo] || '·';
            html += `<div class="plan-activity">
                <span class="plan-activity-icon">${icono}</span>
                <div class="plan-activity-text">
                    <div class="plan-activity-title">${a.titulo}</div>
                    <div class="plan-activity-desc">${a.descripcion}</div>
                    ${esHoy && a.modo ? `<button class="plan-activity-btn" data-modo="${a.modo}" data-params='${JSON.stringify(a.params || {})}'>Empezar →</button>` : ''}
                </div>
            </div>`;
        });
        html += `</div>`;

        if (esHoy && !completado) {
            html += `<button class="plan-day-mark" data-fecha="${d.fecha}">Marcar día como completado</button>`;
        } else if (esHoy && completado) {
            html += `<button class="plan-day-unmark" data-fecha="${d.fecha}">Desmarcar</button>`;
        }
        html += `</div>`;
    });

    html += `</div>`;
    $('#plan-content').innerHTML = html;

    // Cablear
    $('#plan-eliminar')?.addEventListener('click', () => {
        if (confirm('¿Eliminar el plan de estudio? Se borrará también el progreso.')) {
            borrarPlan();
            if (state.timeoutRecordatorio) clearTimeout(state.timeoutRecordatorio);
            renderConfigPlan();
        }
    });

    document.querySelectorAll('.plan-day-mark').forEach(btn => {
        btn.addEventListener('click', () => {
            marcarDiaCompletado(btn.dataset.fecha);
            renderPlanActivo();
        });
    });

    document.querySelectorAll('.plan-day-unmark').forEach(btn => {
        btn.addEventListener('click', () => {
            desmarcarDia(btn.dataset.fecha);
            renderPlanActivo();
        });
    });

    document.querySelectorAll('.plan-activity-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modo = btn.dataset.modo;
            let params = {};
            try { params = JSON.parse(btn.dataset.params || '{}'); } catch (e) {}
            iniciarDesdeReplán(modo, params);
        });
    });
}

function iniciarDesdeReplán(modo, params) {
    // Navegar al modo elegido, intentando pasar parámetros
    if (modo === 'practica' && params.tema) {
        // Abrir config práctica y preseleccionar tema
        abrirConfiguracion('practica');
        setTimeout(() => {
            // Desmarcar todos, marcar solo el tema indicado
            document.querySelectorAll('.topic-chip input[type="checkbox"]').forEach(cb => {
                cb.checked = (cb.value === params.tema);
            });
            // Disparar evento change para actualizar UI
            document.querySelectorAll('.topic-chip input[type="checkbox"]').forEach(cb => {
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            });
        }, 100);
    } else {
        abrirConfiguracion(modo);
    }
}

function actualizarHomePlan() {
    const widget = $('#home-plan-widget');
    if (!widget) return;
    const plan = obtenerPlan();
    if (!plan) {
        widget.hidden = true;
        widget.innerHTML = '';
        return;
    }

    const fechaExamen = new Date(plan.fechaExamen);
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const diasFaltan = diasEntre(hoy, fechaExamen);

    if (diasFaltan < 0) {
        widget.hidden = true;
        return;
    }

    const dias = generarPlanEstudio(fechaExamen, plan.intensidad, plan.hora);
    const fechaHoyISO = fechaISO(hoy);
    const diaHoy = dias.find(d => d.fecha === fechaHoyISO);
    const progreso = obtenerProgresoPlan();
    const completado = !!progreso[fechaHoyISO];

    if (!diaHoy) {
        widget.hidden = true;
        return;
    }

    const actividadesHtml = diaHoy.actividades.map(a => {
        const iconos = { simulacro: '⏱', tema: '📖', repaso: '🔄', smart: '★', descanso: '☕', 'examen-dia': '🎯' };
        return `<span class="home-plan-activity">${iconos[a.tipo] || '·'} ${a.titulo}</span>`;
    }).join('');

    widget.hidden = false;
    widget.innerHTML = `
        <div class="home-plan-card ${completado ? 'is-completed' : ''}">
            <div class="home-plan-head">
                <div>
                    <div class="home-plan-eyebrow">${completado ? '✓ Hoy completado · ' : ''}Faltan ${diasFaltan} ${diasFaltan === 1 ? 'día' : 'días'}</div>
                    <div class="home-plan-title">Plan de hoy</div>
                </div>
                <button class="home-plan-link" id="home-plan-open">Ver plan completo →</button>
            </div>
            <div class="home-plan-activities">${actividadesHtml}</div>
        </div>
    `;
    $('#home-plan-open')?.addEventListener('click', abrirPlan);
}

function renderSeccionTemas(titulo, prefijo, temas) {
    const chips = temas.map(t => `
        <label class="topic-chip">
            <input type="checkbox" data-cat="${prefijo}" value="${t.nombre.replace(/"/g, '&quot;')}" checked>
            <span class="topic-chip-name">${t.nombre}</span>
            <span class="topic-chip-count">${t.count}</span>
        </label>
    `).join('');

    return `
        <div class="config-section">
            <div class="config-section-label">
                <span>${titulo}</span>
                <button class="toggle-all-btn" data-toggle-cat="${prefijo}">Alternar todos</button>
            </div>
            <div class="topic-grid">${chips}</div>
        </div>
    `;
}

function cablearSelectoresTemas() {
    $$('.topic-chip input').forEach(input => {
        input.addEventListener('change', () => {
            if (state.modo === 'examen-personalizado') {
                actualizarBotonStartExamenPersonalizado();
            } else {
                actualizarBotonStartPorTemas();
            }
        });
    });
    $$('.toggle-all-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const cat = btn.dataset.toggleCat;
            const inputs = $$(`.topic-chip input[data-cat="${cat}"]`);
            const algunoSinSeleccionar = inputs.some(i => !i.checked);
            inputs.forEach(i => { i.checked = algunoSinSeleccionar; });
            if (state.modo === 'examen-personalizado') {
                actualizarBotonStartExamenPersonalizado();
            } else {
                actualizarBotonStartPorTemas();
            }
        });
    });
}

function obtenerTemasSeleccionados() {
    const reg = $$('.topic-chip input[data-cat="reg"]:checked').map(i => i.value);
    const esp = $$('.topic-chip input[data-cat="esp"]:checked').map(i => i.value);
    return { reg, esp };
}

function actualizarBotonStartExamenPersonalizado() {
    const { reg, esp } = obtenerTemasSeleccionados();
    const preguntasReg = state.preguntas.filter(p => p.categoria === 'reglamento' && reg.includes(p.tema));
    const preguntasEsp = state.preguntas.filter(p => p.categoria === 'especifica' && esp.includes(p.tema));

    const okReg = preguntasReg.length >= CONFIG.EXAMEN_REGLAMENTO;
    const okEsp = preguntasEsp.length >= CONFIG.EXAMEN_ESPECIFICAS;

    const btn = $('#btn-start');
    if (okReg && okEsp) {
        btn.disabled = false;
        btn.textContent = 'Comenzar examen';
    } else {
        btn.disabled = true;
        const partes = [];
        if (!okReg) partes.push(`reglamento ${preguntasReg.length}/${CONFIG.EXAMEN_REGLAMENTO}`);
        if (!okEsp) partes.push(`específicas ${preguntasEsp.length}/${CONFIG.EXAMEN_ESPECIFICAS}`);
        btn.textContent = `Faltan preguntas (${partes.join(', ')})`;
    }
}

function actualizarBotonStartPorTemas() {
    const { reg, esp } = obtenerTemasSeleccionados();
    const preguntasFiltradas = state.preguntas.filter(p =>
        (p.categoria === 'reglamento' && reg.includes(p.tema)) ||
        (p.categoria === 'especifica' && esp.includes(p.tema))
    );
    const btn = $('#btn-start');
    if (preguntasFiltradas.length === 0) {
        btn.disabled = true;
        btn.textContent = 'Selecciona al menos un tema';
    } else {
        btn.disabled = false;
        btn.textContent = `Comenzar (${preguntasFiltradas.length} preguntas)`;
    }
}

// ============================================================
// INICIO DE SESIÓN DE QUIZ
// ============================================================
function comenzarSesion() {
    const modo = state.modo;

    if (modo === 'examen-oficial') {
        const regs = state.preguntas.filter(p => p.categoria === 'reglamento');
        const esps = state.preguntas.filter(p => p.categoria === 'especifica');
        // 60 reglamento seguidas (mezcladas entre sí) + 20 específicas seguidas (mezcladas entre sí)
        const seleccion = [
            ...shuffle(sample(regs, CONFIG.EXAMEN_REGLAMENTO)),
            ...shuffle(sample(esps, CONFIG.EXAMEN_ESPECIFICAS))
        ];
        iniciarQuiz({
            preguntas: seleccion,
            modoQuiz: 'examen',
            conTimer: true,
            navegableLibre: true,
            corregirAlInstante: false,
            mostrarBanderitas: true,
            etiqueta: 'Examen oficial AESF'
        });
    }
    else if (modo === 'examen-personalizado') {
        const { reg, esp } = obtenerTemasSeleccionados();
        const regs = state.preguntas.filter(p => p.categoria === 'reglamento' && reg.includes(p.tema));
        const esps = state.preguntas.filter(p => p.categoria === 'especifica' && esp.includes(p.tema));
        const seleccion = [
            ...shuffle(sample(regs, CONFIG.EXAMEN_REGLAMENTO)),
            ...shuffle(sample(esps, CONFIG.EXAMEN_ESPECIFICAS))
        ];
        iniciarQuiz({
            preguntas: seleccion,
            modoQuiz: 'examen',
            conTimer: true,
            navegableLibre: true,
            corregirAlInstante: false,
            mostrarBanderitas: true,
            etiqueta: 'Examen personalizado'
        });
    }
    else if (modo === 'practica') {
        const { reg, esp } = obtenerTemasSeleccionados();
        const pool = state.preguntas.filter(p =>
            (p.categoria === 'reglamento' && reg.includes(p.tema)) ||
            (p.categoria === 'especifica' && esp.includes(p.tema))
        );
        iniciarQuiz({
            preguntas: shuffle(pool),
            modoQuiz: 'practica',
            conTimer: false,
            navegableLibre: true,
            corregirAlInstante: true,
            mostrarBanderitas: false,
            etiqueta: 'Práctica'
        });
    }
    else if (modo === 'infinitas') {
        const { reg, esp } = obtenerTemasSeleccionados();
        const pool = state.preguntas.filter(p =>
            (p.categoria === 'reglamento' && reg.includes(p.tema)) ||
            (p.categoria === 'especifica' && esp.includes(p.tema))
        );
        iniciarQuiz({
            preguntas: shuffle(pool),
            pool: pool.slice(),         // copia separada del pool
            modoQuiz: 'infinitas',
            conTimer: false,
            navegableLibre: false,
            corregirAlInstante: true,
            mostrarBanderitas: false,
            etiqueta: 'Preguntas infinitas'
        });
    }
    else if (modo === 'muerte-subita') {
        const { reg, esp } = obtenerTemasSeleccionados();
        const pool = state.preguntas.filter(p =>
            (p.categoria === 'reglamento' && reg.includes(p.tema)) ||
            (p.categoria === 'especifica' && esp.includes(p.tema))
        );
        iniciarQuiz({
            preguntas: shuffle(pool),
            pool: pool.slice(),
            modoQuiz: 'muerte-subita',
            conTimer: false,
            navegableLibre: false,
            corregirAlInstante: true,
            mostrarBanderitas: false,
            etiqueta: 'Muerte súbita'
        });
    }
    else if (modo === 'smart-study') {
        const { reg, esp } = obtenerTemasSeleccionados();
        const tamano = parseInt($('#smart-size').value) || 20;
        const seleccion = generarMezclaSmartStudy(reg, esp, tamano);
        if (seleccion.length === 0) {
            alert('No hay preguntas disponibles con los temas seleccionados.');
            return;
        }
        iniciarQuiz({
            preguntas: seleccion,
            modoQuiz: 'practica',  // se comporta como práctica (corrige al instante)
            conTimer: false,
            navegableLibre: true,
            corregirAlInstante: true,
            mostrarBanderitas: false,
            etiqueta: 'Smart Study'
        });
    }
    else if (modo === 'repaso-rapido') {
        const { reg, esp } = obtenerTemasSeleccionados();
        const pool = state.preguntas.filter(p =>
            (p.categoria === 'reglamento' && reg.includes(p.tema)) ||
            (p.categoria === 'especifica' && esp.includes(p.tema))
        );
        iniciarQuiz({
            preguntas: shuffle(pool),
            modoQuiz: 'repaso',
            conTimer: false,
            navegableLibre: true,
            corregirAlInstante: false, // muestra correcta directamente
            mostrarBanderitas: false,
            etiqueta: 'Repaso rápido'
        });
    }
}

function comenzarRepasoFallos() {
    const fallos = obtenerFallosGuardados();
    const ids = Object.keys(fallos);
    const preguntas = state.preguntas.filter(p => ids.includes(p.id));

    if (preguntas.length === 0) {
        alert('Aún no tienes preguntas falladas. Haz algún examen primero.');
        return;
    }

    state.modo = 'repasar-fallos';
    iniciarQuiz({
        preguntas: shuffle(preguntas),
        modoQuiz: 'practica-fallos',
        conTimer: false,
        navegableLibre: true,
        corregirAlInstante: true,
        mostrarBanderitas: false,
        etiqueta: 'Repasar fallos'
    });
}

// ============================================================
// MOTOR DE QUIZ
// ============================================================
function iniciarQuiz(opciones) {
    const esInfinito = (opciones.modoQuiz === 'infinitas' || opciones.modoQuiz === 'muerte-subita');

    state.examenInicio = Date.now();  // para medir duración

    state.quiz = {
        preguntas: opciones.preguntas,
        pool: opciones.pool || opciones.preguntas.slice(),  // pool independiente para reciclar
        modoQuiz: opciones.modoQuiz,
        navegableLibre: opciones.navegableLibre,
        corregirAlInstante: opciones.corregirAlInstante,
        mostrarBanderitas: opciones.mostrarBanderitas,
        etiqueta: opciones.etiqueta,
        respuestas: {},      // {idPregunta: 'A'|'B'|'C'|'D'}
        corregidas: {},      // (modo práctica/repaso) {idPregunta: true}
        banderitas: new Set(),
        indice: 0,
        finalizado: false,
        conTimer: opciones.conTimer,
        // Contadores para modos infinitos
        aciertos: 0,
        fallos: 0,
        racha: 0,
        rachaMaxima: 0,
        usadasInfinitas: new Set(),  // ids de preguntas ya mostradas en modos infinitos
    };

    mostrarPantalla('quiz');

    // Layout del nav lateral según modo
    const nav = $('#quiz-nav');
    const navMobileBtn = $('#nav-mobile-toggle');
    const layout = document.querySelector('.quiz-layout');
    if (opciones.navegableLibre) {
        nav.style.display = '';
        navMobileBtn.style.display = '';
        layout.classList.remove('no-nav');
    } else {
        nav.style.display = 'none';
        navMobileBtn.style.display = 'none';
        layout.classList.add('no-nav');
    }

    // Botón de finalizar solo si es examen
    const btnFinish = $('#btn-finish');
    btnFinish.hidden = (opciones.modoQuiz !== 'examen');

    // Timer solo en examen
    if (opciones.conTimer) {
        iniciarTemporizador();
    } else {
        ocultarTimer();
    }

    // Botón de banderita visible solo si se permiten
    $('#flag-btn').style.display = opciones.mostrarBanderitas ? '' : 'none';

    // Contador flotante para modos infinitos
    const floating = $('#floating-counter');
    if (esInfinito) {
        floating.hidden = false;
        // En muerte súbita ocultamos los fallos (siempre será 0 hasta que pierdas)
        $('#fc-ko-wrap').style.display = (opciones.modoQuiz === 'muerte-subita') ? 'none' : '';
        actualizarContadorFlotante();
    } else {
        floating.hidden = true;
    }

    // Controles inferiores: ocultar nav prev/next en modos infinitos
    const quizControls = $('#quiz-controls');
    if (esInfinito) {
        quizControls.style.display = 'none';
    } else {
        quizControls.style.display = '';
    }

    // Ocultar CTA grande hasta que se conteste
    $('#quiz-next-cta').classList.remove('is-visible');

    renderQuiz();
}

function actualizarContadorFlotante() {
    const q = state.quiz;
    if (!q) return;
    if (q.modoQuiz === 'muerte-subita') {
        $('#fc-num').textContent = q.aciertos + 1; // pregunta actual = aciertos hechos + 1
    } else {
        $('#fc-num').textContent = q.aciertos + q.fallos + 1;
    }
    $('#fc-ok').textContent = q.aciertos;
    $('#fc-ko').textContent = q.fallos;
}

function renderQuiz() {
    const q = state.quiz;
    const pregunta = q.preguntas[q.indice];
    const esInfinito = (q.modoQuiz === 'infinitas' || q.modoQuiz === 'muerte-subita');

    // Registrar que se ha visto esta pregunta (solo la primera vez por sesión y no durante revisión)
    if (!q.finalizado) {
        if (!q.vistasEnSesion) q.vistasEnSesion = new Set();
        if (!q.vistasEnSesion.has(pregunta.id)) {
            q.vistasEnSesion.add(pregunta.id);
            incrementarVista(pregunta.id);
        }
    }

    // Parar lectura en voz alta si estaba en marcha
    pararAudio();

    // Etiqueta y meta
    if (esInfinito) {
        if (q.modoQuiz === 'muerte-subita') {
            $('#meta-num').textContent = `Racha actual: ${q.aciertos}`;
        } else {
            $('#meta-num').textContent = `Pregunta ${q.aciertos + q.fallos + 1}`;
        }
    } else {
        $('#meta-num').textContent = `Pregunta ${q.indice + 1} / ${q.preguntas.length}`;
    }

    const cat = pregunta.categoria === 'reglamento' ? 'Reglamento' : 'Específica';
    const metaTema = $('#meta-tema');

    if (q.modoQuiz === 'examen') {
        // En examen: solo mostramos la categoría (no el tema concreto, que daría pista)
        metaTema.textContent = cat;
        metaTema.classList.add('meta-pill--categoria');
        metaTema.classList.toggle('is-especifica', pregunta.categoria === 'especifica');
        metaTema.style.display = '';
    } else {
        metaTema.textContent = `${cat} · ${pregunta.tema}`;
        metaTema.classList.remove('meta-pill--categoria', 'is-especifica');
        metaTema.style.display = '';
    }

    // Detectar transición a sección de específicas en examen oficial/personalizado
    if (q.modoQuiz === 'examen' && pregunta.categoria === 'especifica') {
        const anterior = q.indice > 0 ? q.preguntas[q.indice - 1] : null;
        const veniaDeReglamento = anterior && anterior.categoria === 'reglamento';
        // Solo mostrar el aviso una vez por sesión, al cruzar la frontera
        if (veniaDeReglamento && !q.avisoEspecificasMostrado) {
            q.avisoEspecificasMostrado = true;
            mostrarAvisoSeccionEspecificas();
        }
    }

    // Banderita
    const flagBtn = $('#flag-btn');
    if (q.mostrarBanderitas) {
        flagBtn.classList.toggle('is-flagged', q.banderitas.has(pregunta.id));
    }

    // Pregunta
    $('#quiz-question').textContent = pregunta.enunciado;

    // Imagen
    const imgWrap = $('#quiz-image-wrap');
    const img = $('#quiz-image');
    if (pregunta.imagen) {
        imgWrap.hidden = false;
        img.style.display = '';
        img.src = `imagenes/${pregunta.imagen}`;
        img.alt = `Imagen pregunta ${q.indice + 1}`;
        // Si la imagen no existe, mostrar mensaje visible
        img.onerror = () => {
            img.style.display = 'none';
            imgWrap.hidden = false;
            // Quitar cualquier aviso anterior
            const aviso = imgWrap.querySelector('.img-error');
            if (aviso) aviso.remove();
            const div = document.createElement('div');
            div.className = 'img-error';
            div.style.cssText = 'padding:20px; text-align:center; color:var(--danger); border:1px dashed var(--danger); border-radius:8px; background:var(--danger-dim);';
            div.innerHTML = `⚠ No se pudo cargar la imagen<br><small style="color:var(--text-3); font-family:monospace; font-size:11px;">imagenes/${pregunta.imagen}</small>`;
            imgWrap.appendChild(div);
        };
        img.onload = () => {
            const aviso = imgWrap.querySelector('.img-error');
            if (aviso) aviso.remove();
            img.style.display = '';
        };
    } else {
        imgWrap.hidden = true;
        img.src = '';
        const aviso = imgWrap.querySelector('.img-error');
        if (aviso) aviso.remove();
    }

    // Opciones
    const opcionesEl = $('#quiz-options');
    opcionesEl.innerHTML = '';
    opcionesEl.classList.remove('is-locked');

    const letras = Object.keys(pregunta.opciones); // A, B, C, D (puede no estar D)
    letras.forEach(letra => {
        const li = document.createElement('li');
        li.className = 'quiz-option';
        li.dataset.letra = letra;
        li.innerHTML = `
            <span class="quiz-option-letter">${letra}</span>
            <span class="quiz-option-text"></span>
        `;
        li.querySelector('.quiz-option-text').textContent = pregunta.opciones[letra];
        li.addEventListener('click', () => onSeleccionarOpcion(letra));
        opcionesEl.appendChild(li);
    });

    // Aplicar estado actual (si ya respondió o si modo repaso)
    aplicarEstadoOpciones();

    // Feedback (limpiar)
    $('#quiz-feedback').hidden = true;
    $('#quiz-feedback').innerHTML = '';
    $('#quiz-feedback').className = 'quiz-feedback';

    // Si es modo repaso → mostrar la correcta directamente
    if (q.modoQuiz === 'repaso') {
        mostrarRespuestaCorrectaSinPenalizar();
    }
    // Si es práctica y ya estaba corregida (volvió a esa pregunta) → mostrar feedback de nuevo
    else if (q.corregidas[pregunta.id]) {
        mostrarFeedbackPractica();
    }

    // Ocultar/mostrar CTA grande
    $('#quiz-next-cta').classList.remove('is-visible');

    // Botones nav (siguiente/anterior) — solo en modos navegables clásicos
    if (q.navegableLibre) {
        $('#btn-prev').disabled = (q.indice === 0);
        actualizarBotonSiguiente();
        renderNavLateral();
    }
}

function aplicarEstadoOpciones() {
    const q = state.quiz;
    const pregunta = q.preguntas[q.indice];
    const respuestaUsuario = q.respuestas[pregunta.id];
    const fueCorregida = q.corregidas[pregunta.id];
    const opcionesEl = $('#quiz-options');

    if (!respuestaUsuario && !fueCorregida) return;

    // Modo examen: solo marcar como seleccionada (sin colores de correcto/incorrecto)
    if (q.modoQuiz === 'examen' && !q.finalizado) {
        $$('#quiz-options .quiz-option').forEach(li => {
            li.classList.toggle('is-selected', li.dataset.letra === respuestaUsuario);
        });
        return;
    }

    // Modo práctica corregida o examen finalizado: mostrar correcto/incorrecto
    if (fueCorregida || q.finalizado) {
        opcionesEl.classList.add('is-locked');
        $$('#quiz-options .quiz-option').forEach(li => {
            const letra = li.dataset.letra;
            if (letra === pregunta.respuesta_correcta) {
                li.classList.add('is-correct');
            } else if (letra === respuestaUsuario && respuestaUsuario !== pregunta.respuesta_correcta) {
                li.classList.add('is-wrong');
            }
        });
    }
}

function mostrarRespuestaCorrectaSinPenalizar() {
    const q = state.quiz;
    const pregunta = q.preguntas[q.indice];
    const opcionesEl = $('#quiz-options');
    opcionesEl.classList.add('is-locked');
    $$('#quiz-options .quiz-option').forEach(li => {
        if (li.dataset.letra === pregunta.respuesta_correcta) {
            li.classList.add('is-correct');
        }
    });
}

function onSeleccionarOpcion(letra) {
    const q = state.quiz;
    const pregunta = q.preguntas[q.indice];

    // En modo repaso, las opciones están bloqueadas
    if (q.modoQuiz === 'repaso') return;
    // Si ya estaba corregida (práctica), no permitir cambiar
    if (q.corregidas[pregunta.id]) return;
    // Si el examen está finalizado, tampoco
    if (q.finalizado) return;

    q.respuestas[pregunta.id] = letra;

    if (q.corregirAlInstante) {
        // Marcar como corregida
        q.corregidas[pregunta.id] = true;
        const esCorrecta = (letra === pregunta.respuesta_correcta);

        // Modo muerte súbita
        if (q.modoQuiz === 'muerte-subita') {
            if (esCorrecta) {
                q.aciertos++;
                if (q.aciertos > q.rachaMaxima) q.rachaMaxima = q.aciertos;
                aplicarEstadoOpciones();
                mostrarFeedbackPractica();
                mostrarCTASiguiente();
                actualizarContadorFlotante();
            } else {
                q.fallos++;
                guardarFallo(pregunta.id);
                aplicarEstadoOpciones();
                mostrarFeedbackPractica();
                actualizarContadorFlotante();
                // Esperar 1.5s antes de finalizar para que se vea la respuesta
                setTimeout(() => finalizarMuerteSubita(), 1500);
            }
        }
        // Modo infinitas
        else if (q.modoQuiz === 'infinitas') {
            if (esCorrecta) q.aciertos++;
            else { q.fallos++; guardarFallo(pregunta.id); }
            aplicarEstadoOpciones();
            mostrarFeedbackPractica();
            mostrarCTASiguiente();
            actualizarContadorFlotante();
        }
        // Práctica / repaso fallos
        else {
            if (!esCorrecta) {
                guardarFallo(pregunta.id);
            } else if (q.modoQuiz === 'practica-fallos') {
                // Si acierta una pregunta que estaba en la lista de fallos, la quitamos
                eliminarFallo(pregunta.id);
            }
            aplicarEstadoOpciones();
            mostrarFeedbackPractica();
        }
    } else {
        // Modo examen: solo guardamos la selección
        aplicarEstadoOpciones();
        actualizarBotonSiguiente();
    }

    if (q.navegableLibre) renderNavLateral();

    // Persistir la sesión por si el navegador se cierra
    guardarSesionActiva();
}

function mostrarCTASiguiente() {
    const cta = $('#quiz-next-cta');
    cta.classList.add('is-visible');
    cta.textContent = 'Siguiente pregunta →';
}

function finalizarMuerteSubita() {
    const q = state.quiz;
    q.finalizado = true;
    borrarSesionActiva();
    const racha = q.rachaMaxima;
    const esRecord = guardarRecordSD(racha);

    // Guardar en historial
    const duracion = state.examenInicio ? (Date.now() - state.examenInicio) : null;
    guardarExamenEnHistorial({
        fecha: Date.now(),
        etiqueta: 'Muerte súbita',
        modo: 'muerte-subita',
        total: q.aciertos + q.fallos,
        aciertos: q.aciertos,
        fallosReg: 0, fallosEsp: 0,
        aciertosReg: 0, aciertosEsp: 0,
        sinResponder: 0,
        apto: null,
        racha,
        esRecord,
        duracion,
    });

    // Ocultar contador flotante
    $('#floating-counter').hidden = true;

    // Render de resultados específicos
    const verdict = $('#results-verdict');
    verdict.className = 'results-verdict ' + (esRecord ? 'is-pass' : 'is-fail');

    // Confetti si rompió récord
    if (esRecord && racha >= 5) {
        setTimeout(() => lanzarConfetti(3000), 500);
    }

    verdict.innerHTML = `
        <div class="verdict-label">Muerte súbita</div>
        <div class="verdict-title">${racha}</div>
        <div class="verdict-score">${racha === 1 ? 'pregunta acertada' : 'preguntas acertadas seguidas'}${esRecord ? ' · 🏆 Nuevo récord' : ''}</div>
    `;

    // Resumen
    const summary = $('#results-summary');
    const recordActual = obtenerRecordSD();
    summary.innerHTML = `
        <div class="summary-card ok">
            <div class="summary-card-label">Tu racha</div>
            <div class="summary-card-value">${racha}</div>
        </div>
        <div class="summary-card">
            <div class="summary-card-label">Récord histórico</div>
            <div class="summary-card-value">${recordActual.racha}</div>
        </div>
    `;

    // No mostramos lista de fallos detallada en muerte súbita, solo la que tumbó
    const pregunta = q.preguntas[q.indice];
    const failsEl = $('#results-fails');
    failsEl.innerHTML = `
        <div class="results-fails-title">
            La pregunta que te tumbó
        </div>
        <div class="fail-item">
            <div class="fail-num">×</div>
            <div class="fail-body">
                <div class="fail-text">${escapeHtml(pregunta.enunciado)}</div>
                <div class="fail-tags">
                    ${pregunta.codigo_tema ? `<span class="fail-tag">Código: ${pregunta.codigo_tema}</span>` : ''}
                    ${pregunta.pagina_pdf ? `<span class="fail-tag">Pág. PDF ${pregunta.pagina_pdf}</span>` : ''}
                    <span class="fail-tag tema">${pregunta.tema}</span>
                    <span class="fail-tag" style="color:var(--accent); border-color:var(--accent);">Respuesta: ${pregunta.respuesta_correcta}</span>
                </div>
            </div>
        </div>
    `;

    // Ocultar botones que no aplican
    $('#btn-review-answers').style.display = 'none';

    mostrarPantalla('results');
}

function siguienteEnInfinitas() {
    const q = state.quiz;
    // Marcamos la actual como usada
    q.usadasInfinitas.add(q.preguntas[q.indice].id);

    // Avanzamos índice; si nos pasamos del pool barajado, rebarajamos
    q.indice++;
    if (q.indice >= q.preguntas.length) {
        // Re-barajamos el pool original y reseteamos el índice
        q.preguntas = shuffle(q.pool.slice());
        q.indice = 0;
    }
    // Limpiar estado para la próxima (no mantener selección/corrección)
    const next = q.preguntas[q.indice];
    delete q.respuestas[next.id];
    delete q.corregidas[next.id];

    // Ocultar CTA hasta nueva respuesta
    $('#quiz-next-cta').classList.remove('is-visible');
    // Ocultar feedback
    $('#quiz-feedback').hidden = true;

    renderQuiz();
}

function mostrarFeedbackPractica() {
    const q = state.quiz;
    const pregunta = q.preguntas[q.indice];
    const respuestaUsuario = q.respuestas[pregunta.id];
    const esCorrecta = (respuestaUsuario === pregunta.respuesta_correcta);

    const fb = $('#quiz-feedback');
    fb.hidden = false;
    fb.className = 'quiz-feedback ' + (esCorrecta ? 'ok' : 'ko');

    let html;
    if (esCorrecta) {
        html = `<strong>✓ Correcto</strong>La respuesta correcta es la <strong>${pregunta.respuesta_correcta}</strong>.`;
    } else {
        html = `<strong>✕ Incorrecto</strong>La respuesta correcta es la <strong>${pregunta.respuesta_correcta}</strong>.`;
        const detalles = [];
        if (pregunta.codigo_tema) detalles.push(`Código: <code>${pregunta.codigo_tema}</code>`);
        if (pregunta.pagina_pdf) detalles.push(`Página PDF: <code>${pregunta.pagina_pdf}</code>`);
        detalles.push(`Tema: <code>${pregunta.tema}</code>`);
        if (detalles.length) html += `<br>${detalles.join(' · ')}`;
    }
    fb.innerHTML = html;
}

function actualizarBotonSiguiente() {
    const q = state.quiz;
    const btnNext = $('#btn-next');
    const esUltima = (q.indice === q.preguntas.length - 1);

    if (esUltima) {
        if (q.modoQuiz === 'examen') {
            btnNext.textContent = 'Última pregunta';
            btnNext.disabled = true;
        } else {
            btnNext.textContent = 'Finalizar';
            btnNext.disabled = false;
        }
    } else {
        btnNext.disabled = false;
        btnNext.innerHTML = `Siguiente <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;
    }
}

function renderNavLateral() {
    const q = state.quiz;
    if (!q.navegableLibre) return;

    const grid = $('#nav-grid');
    grid.innerHTML = '';

    // Detectar si hay cambio de categoría (reglamento → específica) para insertar separador
    let categoriaAnterior = null;
    let separadorInsertado = false;

    q.preguntas.forEach((p, i) => {
        // Insertar separador si cambia de categoría (solo una vez, de reglamento a específica)
        if (q.modoQuiz === 'examen' && categoriaAnterior === 'reglamento' && p.categoria === 'especifica' && !separadorInsertado) {
            const sep = document.createElement('div');
            sep.className = 'nav-separator';
            sep.innerHTML = '<span>Específicas</span>';
            grid.appendChild(sep);
            separadorInsertado = true;
        }
        categoriaAnterior = p.categoria;

        const cell = document.createElement('button');
        cell.className = 'nav-cell';
        if (q.modoQuiz === 'examen') {
            cell.classList.add(p.categoria === 'especifica' ? 'is-especifica' : 'is-reglamento');
        }
        cell.textContent = i + 1;
        if (i === q.indice) cell.classList.add('is-current');
        if (q.respuestas[p.id] !== undefined) cell.classList.add('is-answered');
        if (q.banderitas.has(p.id)) cell.classList.add('is-flagged');
        cell.addEventListener('click', () => irAPregunta(i));
        grid.appendChild(cell);
    });

    // Contadores
    const respondidas = q.preguntas.filter(p => q.respuestas[p.id] !== undefined).length;
    $('#nav-counter').textContent = `${respondidas} / ${q.preguntas.length}`;
    $('#mobile-counter').textContent = `${respondidas}/${q.preguntas.length}`;
}

function irAPregunta(i) {
    state.quiz.indice = i;
    renderQuiz();
    // Cerrar nav móvil si estaba abierto
    $('#quiz-nav').classList.remove('is-open');
}

function navegar(direccion) {
    const q = state.quiz;

    // En modos infinitos solo se avanza con el CTA grande, no con flechas
    if (q.modoQuiz === 'infinitas' || q.modoQuiz === 'muerte-subita') return;

    const nuevoIdx = q.indice + direccion;
    if (nuevoIdx < 0) return;

    // Finalizar si estamos en la última en práctica/repaso
    if (nuevoIdx >= q.preguntas.length) {
        if (q.modoQuiz === 'practica' || q.modoQuiz === 'repaso' || q.modoQuiz === 'practica-fallos') {
            // Si es repaso de fallos, mostrar un mensaje de cuántos quedan
            irAHome();
            return;
        }
        return;
    }

    q.indice = nuevoIdx;
    renderQuiz();
    guardarSesionActiva();
}

function toggleBanderita() {
    const q = state.quiz;
    if (!q.mostrarBanderitas) return;
    const pregunta = q.preguntas[q.indice];
    if (q.banderitas.has(pregunta.id)) {
        q.banderitas.delete(pregunta.id);
    } else {
        q.banderitas.add(pregunta.id);
    }
    $('#flag-btn').classList.toggle('is-flagged', q.banderitas.has(pregunta.id));
    renderNavLateral();
    guardarSesionActiva();
}

// ============================================================
// TEMPORIZADOR
// ============================================================
function iniciarTemporizador() {
    state.timerEnd = Date.now() + CONFIG.DURACION_EXAMEN_MS;
    state.examenInicio = Date.now();
    const timerEl = $('#exam-timer');
    timerEl.hidden = false;
    timerEl.classList.remove('warn', 'danger');
    actualizarTemporizador();
    state.timerId = setInterval(actualizarTemporizador, 1000);
}

function actualizarTemporizador() {
    const restante = state.timerEnd - Date.now();
    $('#timer-text').textContent = fmtTiempo(restante);
    const timerEl = $('#exam-timer');
    timerEl.classList.remove('warn', 'danger');
    if (restante <= 5 * 60 * 1000) timerEl.classList.add('danger');
    else if (restante <= 15 * 60 * 1000) timerEl.classList.add('warn');

    if (restante <= 0) {
        pararTemporizador();
        finalizarExamen(true);
    }
}

function pararTemporizador() {
    if (state.timerId) {
        clearInterval(state.timerId);
        state.timerId = null;
    }
}

function ocultarTimer() {
    $('#exam-timer').hidden = true;
}

// ============================================================
// FINALIZAR EXAMEN
// ============================================================
function pedirConfirmacionFinalizar() {
    const q = state.quiz;
    const sinResponder = q.preguntas.filter(p => q.respuestas[p.id] === undefined).length;

    const modal = $('#confirm-modal');
    $('#confirm-title').textContent = '¿Finalizar examen?';
    let msg = 'Una vez finalices ya no podrás cambiar respuestas.';
    if (sinResponder > 0) {
        msg = `Te quedan <strong>${sinResponder} preguntas sin contestar</strong>. ${msg}`;
    }
    $('#confirm-message').innerHTML = msg;

    modal.hidden = false;
}

function finalizarExamen(porTiempo = false) {
    const q = state.quiz;
    q.finalizado = true;
    pararTemporizador();
    ocultarTimer();
    borrarSesionActiva();

    // Calcular resultados
    let fallosReg = 0, fallosEsp = 0, aciertosReg = 0, aciertosEsp = 0;
    let sinResponderReg = 0, sinResponderEsp = 0;
    const fallos = [];

    q.preguntas.forEach((p, i) => {
        const respUser = q.respuestas[p.id];
        const correcta = (respUser === p.respuesta_correcta);
        const sinResp = (respUser === undefined);

        if (sinResp) {
            if (p.categoria === 'reglamento') sinResponderReg++;
            else sinResponderEsp++;
            // Sin responder cuenta como fallo
            fallos.push({ pregunta: p, indice: i, respUser: null });
            if (p.categoria === 'reglamento') fallosReg++;
            else fallosEsp++;
        } else if (!correcta) {
            fallos.push({ pregunta: p, indice: i, respUser });
            if (p.categoria === 'reglamento') fallosReg++;
            else fallosEsp++;
            guardarFallo(p.id);
        } else {
            if (p.categoria === 'reglamento') aciertosReg++;
            else aciertosEsp++;
        }
    });

    const aptoReg = fallosReg <= CONFIG.MAX_FALLOS_REGLAMENTO;
    const aptoEsp = fallosEsp <= CONFIG.MAX_FALLOS_ESPECIFICAS;
    const apto = aptoReg && aptoEsp;

    // Guardar en historial
    const duracion = state.examenInicio ? (Date.now() - state.examenInicio) : null;
    guardarExamenEnHistorial({
        fecha: Date.now(),
        etiqueta: q.etiqueta || 'Examen',
        modo: q.modoQuiz,
        total: q.preguntas.length,
        aciertos: aciertosReg + aciertosEsp,
        fallosReg, fallosEsp,
        aciertosReg, aciertosEsp,
        sinResponder: sinResponderReg + sinResponderEsp,
        apto,
        duracion,
        porTiempo
    });

    renderResultados({
        apto, aptoReg, aptoEsp,
        fallosReg, fallosEsp,
        aciertosReg, aciertosEsp,
        sinResponderReg, sinResponderEsp,
        fallos, porTiempo
    });
}

function renderResultados(r) {
    // Veredicto
    const verdict = $('#results-verdict');
    verdict.className = 'results-verdict ' + (r.apto ? 'is-pass' : 'is-fail');

    // ¡Celebración!
    if (r.apto) {
        setTimeout(() => lanzarConfetti(3500), 500);
    }

    const totalReg = r.fallosReg + r.aciertosReg;
    const totalEsp = r.fallosEsp + r.aciertosEsp;
    const totalAciertos = r.aciertosReg + r.aciertosEsp;
    const totalPreguntas = totalReg + totalEsp;

    verdict.innerHTML = `
        <div class="verdict-label">${r.porTiempo ? 'Examen finalizado por tiempo' : 'Resultado final'}</div>
        <div class="verdict-title">${r.apto ? 'APTO' : 'NO APTO'}</div>
        <div class="verdict-score">${totalAciertos} aciertos · ${totalPreguntas - totalAciertos} fallos · ${totalPreguntas} preguntas</div>
    `;

    // Tarjetas resumen
    const summary = $('#results-summary');
    summary.innerHTML = `
        <div class="summary-card ${r.aptoReg ? 'ok' : 'ko'}">
            <div class="summary-card-label">Reglamento</div>
            <div class="summary-card-value">${r.fallosReg} / ${CONFIG.MAX_FALLOS_REGLAMENTO}</div>
            <div class="summary-card-label" style="margin-top:6px; text-transform:none; letter-spacing:0;">fallos · máx ${CONFIG.MAX_FALLOS_REGLAMENTO}</div>
        </div>
        <div class="summary-card ${r.aptoEsp ? 'ok' : 'ko'}">
            <div class="summary-card-label">Específicas</div>
            <div class="summary-card-value">${r.fallosEsp} / ${CONFIG.MAX_FALLOS_ESPECIFICAS}</div>
            <div class="summary-card-label" style="margin-top:6px; text-transform:none; letter-spacing:0;">fallos · máx ${CONFIG.MAX_FALLOS_ESPECIFICAS}</div>
        </div>
        <div class="summary-card">
            <div class="summary-card-label">Sin contestar</div>
            <div class="summary-card-value">${r.sinResponderReg + r.sinResponderEsp}</div>
        </div>
    `;

    // Lista de fallos
    const failsEl = $('#results-fails');
    if (r.fallos.length === 0) {
        failsEl.innerHTML = `
            <div class="results-fails-title">
                Sin fallos
                <span class="count">0</span>
            </div>
            <p style="color:var(--text-2);">¡Examen perfecto!</p>
        `;
    } else {
        const items = r.fallos.map(f => {
            const p = f.pregunta;
            const tags = [];
            if (p.codigo_tema) tags.push(`<span class="fail-tag">Código: ${p.codigo_tema}</span>`);
            if (p.pagina_pdf) tags.push(`<span class="fail-tag">Pág. PDF ${p.pagina_pdf}</span>`);
            tags.push(`<span class="fail-tag tema">${p.tema}</span>`);
            if (f.respUser === null) tags.push(`<span class="fail-tag" style="color:var(--warn); border-color:var(--warn);">Sin contestar</span>`);
            return `
                <div class="fail-item">
                    <div class="fail-num">${f.indice + 1}</div>
                    <div class="fail-body">
                        <div class="fail-text">${escapeHtml(p.enunciado)}</div>
                        <div class="fail-tags">${tags.join('')}</div>
                    </div>
                </div>
            `;
        }).join('');

        failsEl.innerHTML = `
            <div class="results-fails-title">
                Preguntas falladas
                <span class="count">${r.fallos.length}</span>
            </div>
            ${items}
        `;
    }

    mostrarPantalla('results');
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ============================================================
// REVISAR RESPUESTAS DESPUÉS DEL EXAMEN
// ============================================================
function revisarRespuestas() {
    if (!state.quiz) return;
    // Reactivar la pantalla de quiz pero en modo "ya finalizado"
    state.quiz.indice = 0;
    state.quiz.finalizado = true;
    mostrarPantalla('quiz');
    // Ocultar timer y botón finalizar
    ocultarTimer();
    $('#btn-finish').hidden = true;
    // Mostrar el tema ahora (ya no es trampa)
    renderQuiz();
}

// ============================================================
// FALLOS PERSISTENTES (para futuro modo "Repasar fallos")
// ============================================================
function guardarFallo(idPregunta) {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.FAILS);
        const fallos = raw ? JSON.parse(raw) : {};
        fallos[idPregunta] = Date.now();
        localStorage.setItem(CONFIG.STORAGE_KEYS.FAILS, JSON.stringify(fallos));
    } catch (e) {
        console.warn('No se pudo guardar fallo en localStorage', e);
    }
}

// ============================================================
// MODAL DE IMAGEN
// ============================================================
function abrirImagenAmpliada() {
    const q = state.quiz;
    const pregunta = q.preguntas[q.indice];
    if (!pregunta.imagen) return;
    $('#image-modal-img').src = `imagenes/${pregunta.imagen}`;
    $('#image-modal').hidden = false;
    document.body.style.overflow = 'hidden';
}

function cerrarImagenAmpliada() {
    $('#image-modal').hidden = true;
    $('#image-modal-img').src = '';
    document.body.style.overflow = '';
}

// ============================================================
// BUSCADOR
// ============================================================
function abrirBuscador() {
    mostrarPantalla('search');
    const input = $('#search-input');
    input.value = '';
    $('#search-clear').hidden = true;
    $('#search-results').innerHTML = `<p class="search-hint">Empieza a escribir para buscar entre las ${state.preguntas.length} preguntas del banco. También puedes usar filtros sin escribir nada.</p>`;
    // Resetear filtros al abrir
    filtrosBusqueda = {
        categoria: { reglamento: true, especifica: true },
        temas: new Set(),
        conImagen: 'todas',
        estado: 'todas',
    };
    actualizarBadgeFiltros();
    // Asegurarse de que los filtros empiezan ocultos
    $('#search-filters').hidden = true;
    $('.search-layout').classList.remove('with-filters');
    setTimeout(() => input.focus(), 50);
}

function normalizarTexto(s) {
    return String(s || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function buscarPreguntas(query) {
    const q = normalizarTexto(query.trim());
    let resultados = state.preguntas;

    // Filtro por texto (si hay query)
    if (q.length >= 2) {
        const palabras = q.split(/\s+/).filter(Boolean);
        resultados = resultados.filter(p => {
            const texto = normalizarTexto(
                p.enunciado + ' ' + p.codigo_tema + ' ' + p.tema + ' ' +
                Object.values(p.opciones).join(' ')
            );
            return palabras.every(w => texto.includes(w));
        });
    }

    // Aplicar filtros avanzados
    resultados = aplicarFiltros(resultados);
    return resultados;
}

function resaltarCoincidencias(texto, query) {
    if (!query) return escapeHtml(texto);
    const palabras = query.trim().split(/\s+/).filter(p => p.length >= 2);
    let escaped = escapeHtml(texto);
    palabras.forEach(w => {
        const regex = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        escaped = escaped.replace(regex, '<mark>$1</mark>');
    });
    return escaped;
}

function contieneCoincidencia(texto, query) {
    if (!query || !texto) return false;
    const t = normalizarTexto(texto);
    const palabras = normalizarTexto(query).trim().split(/\s+/).filter(p => p.length >= 2);
    return palabras.every(w => t.includes(w));
}

function renderResultadosBusqueda(query) {
    const resultados = buscarPreguntas(query);
    const cont = $('#search-results');
    const hayFiltros = contarFiltrosActivos() > 0;
    const fallos = obtenerFallosGuardados();
    const dominadas = obtenerDominadas();

    if (query.trim().length < 2 && !hayFiltros) {
        cont.innerHTML = `<p class="search-hint">Empieza a escribir para buscar entre las ${state.preguntas.length} preguntas del banco. También puedes usar filtros sin escribir nada.</p>`;
        return;
    }

    if (resultados.length === 0) {
        const msg = query.trim().length >= 2
            ? `No se encontraron preguntas para "${escapeHtml(query)}" con los filtros actuales.`
            : 'Ninguna pregunta cumple los filtros actuales.';
        cont.innerHTML = `<div class="search-empty">${msg}</div>`;
        return;
    }

    const max = 50;
    const mostrados = resultados.slice(0, max);

    let html = `<div class="search-count">${resultados.length} resultado${resultados.length === 1 ? '' : 's'}${resultados.length > max ? ` · mostrando primeros ${max}` : ''}</div>`;

    html += mostrados.map(p => {
        const tags = [
            p.codigo_tema ? `<span class="search-item-tag">${p.codigo_tema}</span>` : '',
            `<span class="search-item-tag tema">${p.tema}</span>`,
            p.pagina_pdf ? `<span class="search-item-tag">Pág. ${p.pagina_pdf}</span>` : '',
            p.imagen ? `<span class="search-item-tag has-img">🖼 Con imagen</span>` : '',
            fallos[p.id] ? `<span class="search-item-tag" style="color:var(--danger); border-color:var(--danger);">Fallada</span>` : '',
            dominadas[p.id] ? `<span class="search-item-tag" style="color:var(--accent); border-color:var(--accent);">Dominada</span>` : '',
        ].filter(Boolean).join('');

        // Si la coincidencia está en una opción (no en el enunciado), mostrar preview
        let optionsPreview = '';
        if (query.trim().length >= 2 && !contieneCoincidencia(p.enunciado, query)) {
            const opcionesCoinciden = Object.entries(p.opciones).filter(([letra, txt]) =>
                contieneCoincidencia(txt, query)
            );
            if (opcionesCoinciden.length > 0) {
                optionsPreview = '<div class="search-item-options">' +
                    opcionesCoinciden.map(([letra, txt]) =>
                        `<div class="search-item-option"><span class="search-item-option-letter">${letra}</span>${resaltarCoincidencias(txt, query)}</div>`
                    ).join('') +
                    '</div>';
            }
        }

        return `
            <button class="search-item" data-id="${p.id}">
                <div class="search-item-tags">${tags}</div>
                <div class="search-item-text">${resaltarCoincidencias(p.enunciado, query)}</div>
                ${optionsPreview}
            </button>
        `;
    }).join('');

    cont.innerHTML = html;

    cont.querySelectorAll('.search-item').forEach(btn => {
        btn.addEventListener('click', () => mostrarDetallePregunta(btn.dataset.id));
    });
}

function mostrarDetallePregunta(id) {
    const p = state.preguntas.find(x => x.id === id);
    if (!p) return;

    const fallos = obtenerFallosGuardados();
    const dominadas = obtenerDominadas();
    const esFallada = !!fallos[p.id];
    const esDominada = !!dominadas[p.id];

    const tags = [
        `<span class="meta-pill">${p.categoria === 'reglamento' ? 'Reglamento' : 'Específica'}</span>`,
        `<span class="meta-pill meta-pill--ghost">${p.tema}</span>`,
        p.codigo_tema ? `<span class="meta-pill meta-pill--ghost">Cód. ${p.codigo_tema}</span>` : '',
        p.pagina_pdf ? `<span class="meta-pill meta-pill--ghost">Pág. PDF ${p.pagina_pdf}</span>` : '',
        esFallada ? `<span class="meta-pill" style="background:var(--danger-dim); color:var(--danger); border-color:var(--danger);">Fallada</span>` : '',
        esDominada ? `<span class="meta-pill" style="background:var(--accent-dim); color:var(--accent); border-color:var(--accent);">Dominada</span>` : '',
    ].filter(Boolean).join('');

    const opciones = Object.entries(p.opciones).map(([letra, texto]) => {
        const esCorrecta = (letra === p.respuesta_correcta);
        return `
            <li class="detail-option ${esCorrecta ? 'is-correct' : ''}">
                <span class="detail-option-letter">${letra}</span>
                <span class="detail-option-text">${escapeHtml(texto)}</span>
            </li>
        `;
    }).join('');

    const imagenHtml = p.imagen
        ? `<button class="detail-image quiz-image-btn" onclick="(function(){document.getElementById('image-modal-img').src='imagenes/${p.imagen}';document.getElementById('image-modal').hidden=false;document.body.style.overflow='hidden';})()"><img src="imagenes/${p.imagen}" alt="Imagen pregunta" onerror="this.parentElement.innerHTML='<div style=&quot;padding:30px; text-align:center; color:var(--danger);&quot;>⚠ No se pudo cargar la imagen<br><small style=&quot;color:var(--text-3); font-family:monospace; font-size:11px;&quot;>imagenes/${p.imagen}</small></div>'"></button>`
        : '';

    // Acciones (dominar, marcar fallada, leer en voz alta)
    const acciones = `
        <div style="display:flex; gap:10px; margin-top:20px; padding-top:20px; border-top:1px solid var(--border); flex-wrap:wrap;">
            <button class="settings-action-btn" id="detail-read">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; margin-right:4px;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                Leer en voz alta
            </button>
            <button class="settings-action-btn" id="detail-toggle-domin" style="${esDominada ? 'color:var(--accent); border-color:var(--accent);' : ''}">
                ${esDominada ? '✓ Ya la domino' : 'Marcar como dominada'}
            </button>
            ${esFallada
                ? `<button class="settings-action-btn" id="detail-unfail">Quitar de "falladas"</button>`
                : `<button class="settings-action-btn" id="detail-fail">Marcar como fallada</button>`
            }
        </div>
    `;

    $('#detail-content').innerHTML = `
        <div class="detail-card">
            <div class="detail-meta">${tags}</div>
            <h2 class="detail-question">${escapeHtml(p.enunciado)}</h2>
            ${imagenHtml}
            <ol class="detail-options">${opciones}</ol>
            ${acciones}
        </div>
    `;

    // Cablear acciones
    $('#detail-read')?.addEventListener('click', () => {
        let texto = p.enunciado + '. ';
        Object.entries(p.opciones).forEach(([letra, txt]) => {
            texto += `Opción ${letra}. ${txt}. `;
        });
        hablar(texto);
    });

    $('#detail-toggle-domin')?.addEventListener('click', () => {
        if (esDominada) desmarcarDominada(p.id);
        else marcarDominada(p.id);
        mostrarDetallePregunta(p.id);  // refrescar
    });

    $('#detail-fail')?.addEventListener('click', () => {
        guardarFallo(p.id);
        mostrarDetallePregunta(p.id);
    });

    $('#detail-unfail')?.addEventListener('click', () => {
        eliminarFallo(p.id);
        mostrarDetallePregunta(p.id);
    });

    mostrarPantalla('detail');
}

// ============================================================
// GENERADOR DE PDF
// ============================================================
function abrirGeneradorPDF() {
    const totalReg = state.preguntas.filter(p => p.categoria === 'reglamento').length;
    const totalEsp = state.preguntas.filter(p => p.categoria === 'especifica').length;

    const html = `
        <div class="config-section">
            <div class="config-section-label"><span>Tipo de examen</span></div>
            <div class="radio-grid">
                <label class="radio-card">
                    <input type="radio" name="pdf-tipo" value="oficial" checked>
                    <div class="radio-card-title">Oficial AESF</div>
                    <div class="radio-card-desc">60 reglamento + 20 específicas</div>
                </label>
                <label class="radio-card">
                    <input type="radio" name="pdf-tipo" value="personalizado">
                    <div class="radio-card-title">Personalizado</div>
                    <div class="radio-card-desc">Eliges cuántas de cada</div>
                </label>
                <label class="radio-card">
                    <input type="radio" name="pdf-tipo" value="tema">
                    <div class="radio-card-title">Por tema</div>
                    <div class="radio-card-desc">Todas las de un tema</div>
                </label>
            </div>
        </div>

        <div class="config-section" id="pdf-personalizado-config" style="display:none;">
            <div class="config-section-label"><span>Cantidad de preguntas</span></div>
            <div class="config-mini-grid">
                <div class="config-mini-field">
                    <label>Reglamento (máx ${totalReg})</label>
                    <input type="number" id="pdf-num-reg" min="0" max="${totalReg}" value="60">
                </div>
                <div class="config-mini-field">
                    <label>Específicas (máx ${totalEsp})</label>
                    <input type="number" id="pdf-num-esp" min="0" max="${totalEsp}" value="20">
                </div>
            </div>
        </div>

        <div class="config-section" id="pdf-tema-config" style="display:none;">
            <div class="config-section-label"><span>Tema a incluir</span></div>
            <select id="pdf-tema-select" class="config-mini-field" style="width:100%; padding:14px; font-size:15px; background:var(--surface); color:var(--text); border:1px solid var(--border); border-radius:8px;"></select>
        </div>

        <div class="config-section">
            <div class="config-section-label"><span>Opciones de salida</span></div>
            <label class="checkbox-row">
                <input type="checkbox" id="pdf-incluir-respuestas" checked>
                <span class="checkbox-row-text">Incluir hoja de respuestas en blanco para rellenar</span>
            </label>
            <label class="checkbox-row">
                <input type="checkbox" id="pdf-incluir-solucionario" checked>
                <span class="checkbox-row-text">Incluir solucionario al final</span>
            </label>
            <label class="checkbox-row">
                <input type="checkbox" id="pdf-incluir-imagenes">
                <span class="checkbox-row-text">Incluir imágenes (puede tardar más)</span>
            </label>
        </div>

        <div class="pdf-progress" id="pdf-progress"></div>
    `;
    $('#pdf-config-content').innerHTML = html;

    // Rellenar el select de temas
    const select = $('#pdf-tema-select');
    [...state.temasDisponibles.reglamento, ...state.temasDisponibles.especifica].forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.nombre;
        opt.textContent = `${t.nombre} (${t.count} preguntas)`;
        select.appendChild(opt);
    });

    // Cambiar visibilidad según tipo
    document.querySelectorAll('input[name="pdf-tipo"]').forEach(r => {
        r.addEventListener('change', () => {
            const tipo = document.querySelector('input[name="pdf-tipo"]:checked').value;
            $('#pdf-personalizado-config').style.display = (tipo === 'personalizado') ? '' : 'none';
            $('#pdf-tema-config').style.display = (tipo === 'tema') ? '' : 'none';
        });
    });

    mostrarPantalla('pdf');
}

async function generarPDF() {
    const tipo = document.querySelector('input[name="pdf-tipo"]:checked').value;
    const incluirRespuestas = $('#pdf-incluir-respuestas').checked;
    const incluirSolucionario = $('#pdf-incluir-solucionario').checked;
    const incluirImagenes = $('#pdf-incluir-imagenes').checked;

    // Recopilar preguntas según tipo
    let preguntasSeleccionadas = [];
    let titulo = '';

    if (tipo === 'oficial') {
        const regs = state.preguntas.filter(p => p.categoria === 'reglamento');
        const esps = state.preguntas.filter(p => p.categoria === 'especifica');
        if (regs.length < 60) {
            alert(`No hay suficientes preguntas de reglamento (${regs.length}/60).`);
            return;
        }
        preguntasSeleccionadas = [...sample(regs, 60), ...sample(esps, Math.min(20, esps.length))];
        titulo = 'Examen oficial AESF';
    } else if (tipo === 'personalizado') {
        const nReg = parseInt($('#pdf-num-reg').value) || 0;
        const nEsp = parseInt($('#pdf-num-esp').value) || 0;
        const regs = state.preguntas.filter(p => p.categoria === 'reglamento');
        const esps = state.preguntas.filter(p => p.categoria === 'especifica');
        preguntasSeleccionadas = [
            ...sample(regs, Math.min(nReg, regs.length)),
            ...sample(esps, Math.min(nEsp, esps.length))
        ];
        titulo = `Examen personalizado · ${nReg + nEsp} preguntas`;
    } else if (tipo === 'tema') {
        const tema = $('#pdf-tema-select').value;
        preguntasSeleccionadas = state.preguntas.filter(p => p.tema === tema);
        titulo = `Banco completo · ${tema}`;
    }

    if (preguntasSeleccionadas.length === 0) {
        alert('No hay preguntas que coincidan con los criterios.');
        return;
    }

    // Mezclar aleatoriamente
    preguntasSeleccionadas = shuffle(preguntasSeleccionadas);

    const progress = $('#pdf-progress');
    progress.classList.add('visible');
    progress.textContent = 'Generando PDF...';

    const btn = $('#btn-generate-pdf');
    btn.disabled = true;
    btn.classList.add('btn-loading');
    btn.innerHTML = '<span class="spinner spinner-inline"></span> Generando...';

    try {
        await crearPDF(preguntasSeleccionadas, titulo, { incluirRespuestas, incluirSolucionario, incluirImagenes }, progress);
        progress.textContent = '✓ PDF generado y descargado.';
    } catch (err) {
        console.error(err);
        progress.textContent = 'Error generando el PDF: ' + err.message;
    } finally {
        btn.disabled = false;
        btn.classList.remove('btn-loading');
        btn.textContent = 'Generar PDF';
    }
}

async function crearPDF(preguntas, titulo, opts, progress) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const PAGE_W = 210, PAGE_H = 297;
    const MARGIN_X = 18, MARGIN_TOP = 22, MARGIN_BOTTOM = 22;
    const MAX_W = PAGE_W - 2 * MARGIN_X;
    const FECHA = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });

    let y = MARGIN_TOP;

    // -------- Función auxiliar para el encabezado de cada página --------
    function nuevaPagina(esContinuacion = true) {
        doc.addPage();
        y = MARGIN_TOP;
        if (esContinuacion) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(120);
            doc.text(titulo, MARGIN_X, 12);
            doc.text(FECHA, PAGE_W - MARGIN_X, 12, { align: 'right' });
            doc.setDrawColor(220);
            doc.line(MARGIN_X, 14, PAGE_W - MARGIN_X, 14);
        }
    }

    function piePagina() {
        const total = doc.internal.getNumberOfPages();
        for (let i = 1; i <= total; i++) {
            doc.setPage(i);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(140);
            doc.text(`Página ${i} de ${total}`, PAGE_W / 2, PAGE_H - 10, { align: 'center' });
        }
    }

    // -------- Portada --------
    doc.setFillColor(10, 14, 26);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

    doc.setFillColor(0, 168, 94);
    doc.rect(0, 65, PAGE_W, 2, 'F');

    doc.setTextColor(0, 217, 126);
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.text('AESF · BANCO DE PREGUNTAS', MARGIN_X, 50);

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(32);
    doc.text(titulo, MARGIN_X, 90);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(180, 190, 210);
    doc.text(`${preguntas.length} preguntas · ${FECHA}`, MARGIN_X, 102);

    // Bloque info
    doc.setFillColor(26, 33, 56);
    doc.rect(MARGIN_X, 130, MAX_W, 55, 'F');
    doc.setTextColor(220, 230, 250);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('INSTRUCCIONES', MARGIN_X + 6, 140);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const instrucciones = [
        '· Rellena la hoja de respuestas marcando una sola opción (A, B, C o D) por pregunta.',
        '· Para considerarse APTO no se debe fallar más de 12 preguntas de Reglamento ni más de 7 de Específicas.',
        '· Tiempo orientativo del examen oficial: 2 horas.',
        '· En la última sección encontrarás el solucionario detallado.'
    ];
    let yInstr = 148;
    instrucciones.forEach(t => {
        const lineas = doc.splitTextToSize(t, MAX_W - 12);
        doc.text(lineas, MARGIN_X + 6, yInstr);
        yInstr += lineas.length * 5;
    });

    // Pie de portada
    doc.setFontSize(8);
    doc.setTextColor(120, 130, 160);
    doc.text('Generado con Banco de Preguntas AESF', MARGIN_X, PAGE_H - 14);

    // Reset color para el resto
    doc.setTextColor(20, 20, 20);

    // -------- Enunciados --------
    nuevaPagina(false);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Enunciados', MARGIN_X, y);
    y += 10;
    doc.setDrawColor(180);
    doc.line(MARGIN_X, y - 4, PAGE_W - MARGIN_X, y - 4);

    for (let i = 0; i < preguntas.length; i++) {
        const p = preguntas[i];
        progress.textContent = `Generando pregunta ${i + 1} / ${preguntas.length}...`;
        await new Promise(r => setTimeout(r, 0));

        // Numero pregunta
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        const num = `${i + 1}.`;
        doc.text(num, MARGIN_X, y);

        // Enunciado
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const enunciadoLineas = doc.splitTextToSize(p.enunciado, MAX_W - 10);
        doc.text(enunciadoLineas, MARGIN_X + 8, y);
        y += enunciadoLineas.length * 5 + 2;

        // Imagen (opcional)
        if (opts.incluirImagenes && p.imagen) {
            try {
                const imgData = await cargarImagenComoDataURL(`imagenes/${p.imagen}`);
                if (imgData) {
                    if (y + 50 > PAGE_H - MARGIN_BOTTOM) nuevaPagina();
                    const props = doc.getImageProperties(imgData);
                    const maxImgW = Math.min(MAX_W - 10, 80);
                    const ratio = props.width / props.height;
                    let w = maxImgW;
                    let h = w / ratio;
                    if (h > 50) { h = 50; w = h * ratio; }
                    doc.addImage(imgData, 'PNG', MARGIN_X + 8, y, w, h);
                    y += h + 3;
                }
            } catch (e) { /* ignorar errores de imagen */ }
        }

        // Opciones
        const letras = Object.keys(p.opciones);
        letras.forEach(letra => {
            const txt = `${letra})  ${p.opciones[letra]}`;
            const lineas = doc.splitTextToSize(txt, MAX_W - 14);
            if (y + lineas.length * 4.5 > PAGE_H - MARGIN_BOTTOM) nuevaPagina();
            doc.text(lineas, MARGIN_X + 12, y);
            y += lineas.length * 4.5 + 1;
        });

        y += 5;

        // Salto si nos pasamos
        if (y > PAGE_H - MARGIN_BOTTOM - 10 && i < preguntas.length - 1) nuevaPagina();
    }

    // -------- Hoja de respuestas --------
    if (opts.incluirRespuestas) {
        progress.textContent = 'Añadiendo hoja de respuestas...';
        await new Promise(r => setTimeout(r, 0));
        doc.addPage();
        y = MARGIN_TOP;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text('Hoja de respuestas', MARGIN_X, y);
        y += 8;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(80);
        doc.text('Marca con una X la opción elegida para cada pregunta.', MARGIN_X, y);
        y += 8;

        doc.setTextColor(20);
        // Tabla de respuestas: 4 columnas
        const cols = 4;
        const colW = MAX_W / cols;
        const filas = Math.ceil(preguntas.length / cols);
        const altoFila = 7;

        // Cabeceras
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        for (let c = 0; c < cols; c++) {
            const x = MARGIN_X + c * colW;
            doc.text('Nº', x + 4, y);
            doc.text('A', x + 14, y);
            doc.text('B', x + 22, y);
            doc.text('C', x + 30, y);
            doc.text('D', x + 38, y);
        }
        y += 4;
        doc.setDrawColor(180);
        doc.line(MARGIN_X, y - 2, PAGE_W - MARGIN_X, y - 2);

        doc.setFont('helvetica', 'normal');
        for (let f = 0; f < filas; f++) {
            for (let c = 0; c < cols; c++) {
                const i = f + c * filas;
                if (i >= preguntas.length) continue;
                const x = MARGIN_X + c * colW;
                doc.setFont('helvetica', 'bold');
                doc.text(String(i + 1), x + 4, y);
                doc.setFont('helvetica', 'normal');
                // 4 círculos
                ['A', 'B', 'C', 'D'].forEach((l, idx) => {
                    doc.circle(x + 14 + idx * 8, y - 1.2, 1.6);
                });
            }
            y += altoFila;
            if (y > PAGE_H - MARGIN_BOTTOM) {
                doc.addPage();
                y = MARGIN_TOP;
            }
        }
    }

    // -------- Solucionario --------
    if (opts.incluirSolucionario) {
        progress.textContent = 'Añadiendo solucionario...';
        await new Promise(r => setTimeout(r, 0));
        doc.addPage();
        y = MARGIN_TOP;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text('Solucionario', MARGIN_X, y);
        y += 10;
        doc.setDrawColor(180);
        doc.line(MARGIN_X, y - 4, PAGE_W - MARGIN_X, y - 4);

        // Tabla compacta: Nº, Correcta, Código tema, Pág PDF, Tema
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text('Nº', MARGIN_X, y);
        doc.text('Resp.', MARGIN_X + 14, y);
        doc.text('Código', MARGIN_X + 32, y);
        doc.text('Pág.', MARGIN_X + 60, y);
        doc.text('Tema', MARGIN_X + 75, y);
        y += 3;
        doc.line(MARGIN_X, y - 1, PAGE_W - MARGIN_X, y - 1);
        y += 3;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        preguntas.forEach((p, i) => {
            if (y > PAGE_H - MARGIN_BOTTOM) {
                doc.addPage();
                y = MARGIN_TOP;
            }
            doc.text(String(i + 1), MARGIN_X, y);
            doc.setFont('helvetica', 'bold');
            doc.text(p.respuesta_correcta, MARGIN_X + 14, y);
            doc.setFont('helvetica', 'normal');
            doc.text(p.codigo_tema || '—', MARGIN_X + 32, y);
            doc.text(p.pagina_pdf ? String(p.pagina_pdf) : '—', MARGIN_X + 60, y);
            doc.text(p.tema, MARGIN_X + 75, y);
            y += 5.5;
        });
    }

    // Pie de página global
    piePagina();

    // Descarga
    const nombre = `examen_${titulo.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.pdf`;
    doc.save(nombre);
}

function cargarImagenComoDataURL(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                canvas.getContext('2d').drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}


function mostrarResumenInfinitas() {
    const q = state.quiz;
    q.finalizado = true;
    $('#floating-counter').hidden = true;

    const total = q.aciertos + q.fallos;
    const porcentaje = total === 0 ? 0 : Math.round((q.aciertos / total) * 100);

    const verdict = $('#results-verdict');
    verdict.className = 'results-verdict ' + (porcentaje >= 70 ? 'is-pass' : 'is-fail');
    verdict.innerHTML = `
        <div class="verdict-label">Sesión de preguntas infinitas</div>
        <div class="verdict-title">${porcentaje}%</div>
        <div class="verdict-score">${q.aciertos} aciertos · ${q.fallos} fallos · ${total} preguntas</div>
    `;

    $('#results-summary').innerHTML = `
        <div class="summary-card ok">
            <div class="summary-card-label">Aciertos</div>
            <div class="summary-card-value">${q.aciertos}</div>
        </div>
        <div class="summary-card ko">
            <div class="summary-card-label">Fallos</div>
            <div class="summary-card-value">${q.fallos}</div>
        </div>
        <div class="summary-card">
            <div class="summary-card-label">% Acierto</div>
            <div class="summary-card-value">${porcentaje}%</div>
        </div>
    `;

    $('#results-fails').innerHTML = '';
    $('#btn-review-answers').style.display = 'none';

    mostrarPantalla('results');
}


// ============================================================
// ESTADÍSTICAS
// ============================================================
function abrirEstadisticas() {
    const content = $('#stats-content');
    // Mostrar loading mientras se calcula
    content.innerHTML = `<div class="loading-state"><span class="spinner"></span> Calculando estadísticas...</div>`;
    mostrarPantalla('stats');

    // Ceder el hilo para que se vea el spinner antes del cálculo pesado
    setTimeout(() => {
        renderEstadisticas();
    }, 30);
}

function renderEstadisticas() {
    const hist = obtenerHistorial();
    const fallos = obtenerFallosGuardados();
    const dominadas = obtenerDominadas();
    const vistas = obtenerVistas();
    const recordSD = obtenerRecordSD();

    const content = $('#stats-content');

    // ----- Tarjetas resumen -----
    const examenesHechos = hist.filter(h => h.modo === 'examen').length;
    const aptos = hist.filter(h => h.modo === 'examen' && h.apto).length;
    const ratioAptos = examenesHechos === 0 ? 0 : Math.round((aptos / examenesHechos) * 100);

    const idsPreguntas = state.preguntas.map(p => p.id);
    const numFallos = Object.keys(fallos).filter(id => idsPreguntas.includes(id) && !dominadas[id]).length;
    const numDominadas = Object.keys(dominadas).filter(id => idsPreguntas.includes(id)).length;
    const numVistas = Object.keys(vistas).filter(id => idsPreguntas.includes(id)).length;
    const cobertura = state.preguntas.length === 0 ? 0 :
                      Math.round((numVistas / state.preguntas.length) * 100);

    let html = `
        <div class="stats-overview">
            <div class="stats-card accent">
                <div class="stats-card-label">Exámenes hechos</div>
                <div class="stats-card-value">${examenesHechos}</div>
                <div class="stats-card-sub">${aptos} aptos · ${ratioAptos}% éxito</div>
            </div>
            <div class="stats-card flag">
                <div class="stats-card-label">Cobertura del banco</div>
                <div class="stats-card-value">${cobertura}%</div>
                <div class="stats-card-sub">${numVistas} de ${state.preguntas.length} vistas</div>
            </div>
            <div class="stats-card danger">
                <div class="stats-card-label">Pendientes de repasar</div>
                <div class="stats-card-value">${numFallos}</div>
                <div class="stats-card-sub">${numDominadas} ya dominadas</div>
            </div>
            <div class="stats-card accent">
                <div class="stats-card-label">Récord muerte súbita</div>
                <div class="stats-card-value">${recordSD.racha || 0}</div>
                <div class="stats-card-sub">${recordSD.racha ? new Date(recordSD.fecha).toLocaleDateString('es-ES') : 'Sin récord aún'}</div>
            </div>
        </div>
    `;

    // ----- Evolución (gráfica) -----
    const examenes = hist.filter(h => h.modo === 'examen').slice(0, 20).reverse();
    if (examenes.length > 0) {
        html += `<div class="stats-section">
            <h3 class="stats-section-title">Evolución</h3>
            <p class="stats-section-sub">Tus últimos ${examenes.length} exámenes ordenados cronológicamente.</p>
            <div class="chart-wrap">${renderChartSVG(examenes)}</div>
        </div>`;
    }

    // ----- Heatmap por tema -----
    const statsTemas = calcularStatsPorTema();
    if (statsTemas.length > 0) {
        html += `<div class="stats-section">
            <h3 class="stats-section-title">Por tema</h3>
            <p class="stats-section-sub">% de acierto en preguntas vistas. Las que están en rojo son las que más fallas.</p>
            <div class="heatmap">${statsTemas.map(t => {
                const colorFn = (pct) => {
                    if (pct >= 85) return '#00d97e';
                    if (pct >= 70) return '#9ed500';
                    if (pct >= 55) return '#ffb547';
                    if (pct >= 40) return '#ff8c47';
                    return '#ff5470';
                };
                const color = colorFn(t.porcentaje);
                const ancho = Math.max(t.porcentaje, 5);
                return `<div class="heatmap-row">
                    <div class="heatmap-tema">${t.tema}</div>
                    <div class="heatmap-bar-wrap">
                        <div class="heatmap-bar" style="width: ${ancho}%; background: ${color};">${t.porcentaje}%</div>
                    </div>
                    <div class="heatmap-stats">${t.aciertos}/${t.intentadas}</div>
                </div>`;
            }).join('')}</div>
        </div>`;
    }

    // ----- Efecto del repaso: aciertos vs número de veces vista -----
    const repaso = calcularEfectoRepaso();
    if (repaso.total > 0) {
        html += `<div class="stats-section">
            <h3 class="stats-section-title">El repaso funciona</h3>
            <p class="stats-section-sub">Tu % de acierto según cuántas veces hayas visto una pregunta.</p>
            <div class="repaso-grid">`;

        repaso.buckets.forEach(b => {
            const color = b.pct === null ? 'var(--text-3)' :
                          b.pct >= 85 ? '#00d97e' :
                          b.pct >= 70 ? '#9ed500' :
                          b.pct >= 55 ? '#ffb547' :
                          '#ff5470';
            const pctStr = b.pct === null ? '—' : `${b.pct}%`;
            html += `<div class="repaso-bucket">
                <div class="repaso-bucket-label">${b.label}</div>
                <div class="repaso-bucket-bar-wrap">
                    <div class="repaso-bucket-bar" style="height:${b.pct === null ? 0 : Math.max(b.pct, 4)}%; background:${color};"></div>
                </div>
                <div class="repaso-bucket-pct" style="color:${color};">${pctStr}</div>
                <div class="repaso-bucket-count">${b.preguntas} preg.</div>
            </div>`;
        });
        html += `</div>`;

        if (repaso.insight) {
            html += `<div class="stats-insight" style="margin-top:18px;">${repaso.insight}</div>`;
        }
        html += `</div>`;
    }

    // ----- Stats por franja horaria y día -----
    const statsHora = calcularStatsPorHora();
    const statsDia = calcularStatsPorDiaSemana();
    const tieneSesiones = statsHora.some(s => s.sesiones > 0);

    if (tieneSesiones) {
        // Mejor franja y mejor día
        const mejorFranja = [...statsHora].filter(s => s.pct !== null).sort((a, b) => b.pct - a.pct)[0];
        const mejorDia = [...statsDia].filter(s => s.pct !== null).sort((a, b) => b.pct - a.pct)[0];

        html += `<div class="stats-section">
            <h3 class="stats-section-title">Cuándo rindes mejor</h3>
            <p class="stats-section-sub">Tu rendimiento según la hora y el día. Aprovecha tus momentos punta.</p>`;

        if (mejorFranja && mejorDia && mejorFranja.sesiones >= 2 && mejorDia.sesiones >= 2) {
            html += `<div class="stats-insight">
                Rindes mejor los <strong>${mejorDia.dia}</strong> (${mejorDia.pct}% acierto) y entre las <strong>${mejorFranja.label}</strong>h (${mejorFranja.pct}% acierto).
            </div>`;
        } else {
            html += `<div class="stats-insight stats-insight--neutral">
                Necesitas más sesiones (al menos 2-3 en distintas franjas) para detectar patrones fiables.
            </div>`;
        }

        // Barras por franja horaria
        html += `<div class="stats-subsection-title">Por franja horaria</div>
            <div class="hora-grid">`;
        statsHora.forEach(f => {
            if (f.sesiones === 0) {
                html += `<div class="hora-cell hora-cell--empty">
                    <div class="hora-label">${f.label}</div>
                    <div class="hora-bar-wrap"><div class="hora-bar" style="height: 0%"></div></div>
                    <div class="hora-val">—</div>
                </div>`;
            } else {
                const color = f.pct >= 80 ? '#00d97e' : f.pct >= 60 ? '#ffb547' : '#ff5470';
                html += `<div class="hora-cell">
                    <div class="hora-label">${f.label}</div>
                    <div class="hora-bar-wrap"><div class="hora-bar" style="height: ${Math.max(f.pct, 5)}%; background:${color};"></div></div>
                    <div class="hora-val">${f.pct}%</div>
                    <div class="hora-sub">${f.sesiones} ses.</div>
                </div>`;
            }
        });
        html += `</div>`;

        // Tabla por día de la semana
        html += `<div class="stats-subsection-title">Por día de la semana</div>
            <div class="dia-grid">`;
        statsDia.forEach(d => {
            if (d.sesiones === 0) {
                html += `<div class="dia-cell dia-cell--empty">
                    <div class="dia-label">${d.dia}</div>
                    <div class="dia-val">—</div>
                </div>`;
            } else {
                const color = d.pct >= 80 ? '#00d97e' : d.pct >= 60 ? '#ffb547' : '#ff5470';
                html += `<div class="dia-cell" style="border-color:${color};">
                    <div class="dia-label">${d.dia}</div>
                    <div class="dia-val" style="color:${color};">${d.pct}%</div>
                    <div class="dia-sub">${d.sesiones} ses.</div>
                </div>`;
            }
        });
        html += `</div></div>`;
    }

    // ----- Historial -----
    if (hist.length > 0) {
        html += `<div class="stats-section">
            <h3 class="stats-section-title">Historial</h3>
            <p class="stats-section-sub">Tus últimas ${Math.min(hist.length, 20)} sesiones.</p>
            <div class="history-list">${hist.slice(0, 20).map(h => {
                const fecha = new Date(h.fecha);
                const fechaStr = fecha.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) +
                                 ' · ' + fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                const totalFallos = (h.fallosReg || 0) + (h.fallosEsp || 0);
                const pct = h.total === 0 ? 0 : Math.round((h.aciertos / h.total) * 100);
                const durStr = h.duracion ? fmtTiempoCorto(h.duracion) : '';
                const badge = h.modo === 'examen'
                    ? `<span class="history-badge ${h.apto ? '' : 'ko'}">${h.apto ? 'APTO' : 'NO APTO'}</span>`
                    : '';
                return `<div class="history-item">
                    <div class="history-verdict ${h.apto || h.modo !== 'examen' ? '' : 'ko'}"></div>
                    <div>
                        <div class="history-info-main">${h.etiqueta}</div>
                        <div class="history-info-sub">${fechaStr}${durStr ? ' · ' + durStr : ''} · ${h.aciertos}/${h.total}${totalFallos ? ' · ' + totalFallos + ' fallos' : ''}</div>
                    </div>
                    <div class="history-score ${pct >= 70 ? 'history-score-ok' : 'history-score-ko'}">${pct}%</div>
                    ${badge}
                </div>`;
            }).join('')}</div>
        </div>`;
    } else {
        html += `<div class="stats-section">
            <div class="stats-empty">Aún no hay datos. Haz tu primer examen y empezarás a ver tu progreso aquí.</div>
        </div>`;
    }

    content.innerHTML = html;
}

function fmtTiempoCorto(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function calcularStatsPorTema() {
    const fallosActuales = obtenerFallosGuardados();
    const vistas = obtenerVistas();
    const porTema = {};
    state.preguntas.forEach(p => {
        if (!vistas[p.id]) return;
        if (!porTema[p.tema]) porTema[p.tema] = { tema: p.tema, intentadas: 0, fallidas: 0 };
        porTema[p.tema].intentadas++;
        if (fallosActuales[p.id]) porTema[p.tema].fallidas++;
    });
    return Object.values(porTema)
        .map(t => ({
            ...t,
            aciertos: t.intentadas - t.fallidas,
            porcentaje: t.intentadas === 0 ? 0 : Math.round(((t.intentadas - t.fallidas) / t.intentadas) * 100)
        }))
        .sort((a, b) => a.porcentaje - b.porcentaje);
}

function renderChartSVG(examenes) {
    if (examenes.length === 0) return '';
    const W = 800, H = 220, PAD_L = 40, PAD_R = 20, PAD_T = 30, PAD_B = 40;
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;
    const max = 100, min = 0;
    const step = examenes.length > 1 ? innerW / (examenes.length - 1) : innerW;

    const pts = examenes.map((e, i) => {
        const pct = e.total === 0 ? 0 : (e.aciertos / e.total) * 100;
        const x = PAD_L + i * step;
        const y = PAD_T + innerH - ((pct - min) / (max - min)) * innerH;
        return { x, y, pct: Math.round(pct), apto: e.apto, fecha: e.fecha };
    });

    const lineasY = [0, 50, 70, 85, 100];
    const ejeY = lineasY.map(v => {
        const y = PAD_T + innerH - ((v - min) / (max - min)) * innerH;
        return `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="rgba(120,135,165,0.15)" stroke-dasharray="2 4"/>
                <text x="${PAD_L - 6}" y="${y + 4}" font-size="10" fill="#7888a8" text-anchor="end" font-family="JetBrains Mono">${v}</text>`;
    }).join('');

    const yAprobado = PAD_T + innerH - ((85 - min) / (max - min)) * innerH;
    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const areaPath = linePath + ` L ${pts[pts.length - 1].x} ${PAD_T + innerH} L ${pts[0].x} ${PAD_T + innerH} Z`;
    const dots = pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${p.apto ? '#00d97e' : '#ff5470'}" stroke="var(--surface)" stroke-width="2"/>`).join('');

    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        <defs>
            <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#00d97e" stop-opacity="0.3"/>
                <stop offset="100%" stop-color="#00d97e" stop-opacity="0"/>
            </linearGradient>
        </defs>
        ${ejeY}
        <line x1="${PAD_L}" y1="${yAprobado}" x2="${W - PAD_R}" y2="${yAprobado}" stroke="#00d97e" stroke-opacity="0.4" stroke-width="1.2"/>
        <path d="${areaPath}" fill="url(#chart-grad)"/>
        <path d="${linePath}" stroke="#00d97e" stroke-width="2.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
        <text x="${PAD_L}" y="${H - 10}" font-size="10" fill="#7888a8" font-family="JetBrains Mono">+ antiguo</text>
        <text x="${W - PAD_R}" y="${H - 10}" font-size="10" fill="#7888a8" font-family="JetBrains Mono" text-anchor="end">+ reciente</text>
    </svg>`;
}

// ============================================================
// AJUSTES
// ============================================================
function abrirAjustes() {
    const fallos = obtenerFallosGuardados();
    const dominadas = obtenerDominadas();
    const hist = obtenerHistorial();
    const recordSD = obtenerRecordSD();
    const vistas = obtenerVistas();
    const settings = obtenerSettings();

    const numFallos = Object.keys(fallos).length;
    const numDominadas = Object.keys(dominadas).length;
    const numHist = hist.length;
    const numVistas = Object.keys(vistas).length;

    let html = `
        <div class="settings-block">
            <div class="settings-block-title">Voz</div>
            <div class="settings-block-sub">Configura cómo se leen las preguntas en voz alta.</div>
            <div class="settings-row">
                <div class="settings-row-info">
                    <div class="settings-row-label">Voz del sistema</div>
                    <div class="settings-row-sub">Disponibles las voces instaladas en tu dispositivo</div>
                </div>
                <div class="settings-control">
                    <select id="voice-select"><option>Cargando...</option></select>
                </div>
            </div>
            <div class="settings-row">
                <div class="settings-row-info">
                    <div class="settings-row-label">Velocidad</div>
                    <div class="settings-row-sub">Más rápido o más lento</div>
                </div>
                <div class="settings-control">
                    <input type="range" id="voice-rate" min="0.6" max="1.6" step="0.1" value="${settings.rate || 1}">
                    <span class="value-display" id="voice-rate-val">${(settings.rate || 1).toFixed(1)}x</span>
                </div>
            </div>
            <div class="settings-row">
                <div class="settings-row-info">
                    <div class="settings-row-label">Probar</div>
                    <div class="settings-row-sub">Escucha cómo suena con la configuración actual</div>
                </div>
                <button class="settings-action-btn" id="voice-test">Probar voz</button>
            </div>
        </div>

        <div class="settings-block">
            <div class="settings-block-title">Mis datos</div>
            <div class="settings-block-sub">Aquí puedes gestionar o eliminar la información guardada en este dispositivo.</div>

            <div class="settings-row">
                <div class="settings-row-info">
                    <div class="settings-row-label">Historial de exámenes</div>
                    <div class="settings-row-sub">${numHist} sesiones guardadas</div>
                </div>
                <button class="settings-action-btn danger" id="btn-clear-history" ${numHist === 0 ? 'disabled' : ''}>Borrar</button>
            </div>

            <div class="settings-row">
                <div class="settings-row-info">
                    <div class="settings-row-label">Preguntas falladas</div>
                    <div class="settings-row-sub">${numFallos} preguntas marcadas como falladas</div>
                </div>
                <button class="settings-action-btn danger" id="btn-clear-fails" ${numFallos === 0 ? 'disabled' : ''}>Borrar</button>
            </div>

            <div class="settings-row">
                <div class="settings-row-info">
                    <div class="settings-row-label">Preguntas dominadas</div>
                    <div class="settings-row-sub">${numDominadas} preguntas excluidas de Smart Study</div>
                </div>
                <button class="settings-action-btn danger" id="btn-clear-dominadas" ${numDominadas === 0 ? 'disabled' : ''}>Borrar</button>
            </div>

            <div class="settings-row">
                <div class="settings-row-info">
                    <div class="settings-row-label">Récord muerte súbita</div>
                    <div class="settings-row-sub">${recordSD.racha ? `Tu récord es de ${recordSD.racha} aciertos` : 'Sin récord aún'}</div>
                </div>
                <button class="settings-action-btn danger" id="btn-clear-record" ${!recordSD.racha ? 'disabled' : ''}>Reiniciar</button>
            </div>

            <div class="settings-row">
                <div class="settings-row-info">
                    <div class="settings-row-label">Contador de vistas</div>
                    <div class="settings-row-sub">Has visto ${numVistas} preguntas distintas</div>
                </div>
                <button class="settings-action-btn danger" id="btn-clear-seen" ${numVistas === 0 ? 'disabled' : ''}>Borrar</button>
            </div>

            <div class="settings-row">
                <div class="settings-row-info">
                    <div class="settings-row-label" style="color: var(--danger);">Borrar todo</div>
                    <div class="settings-row-sub">Resetea completamente la aplicación. <strong>Acción irreversible.</strong></div>
                </div>
                <button class="settings-action-btn danger" id="btn-clear-all">Borrar todo</button>
            </div>
        </div>

        <div class="settings-block">
            <div class="settings-block-title">Respaldo de datos</div>
            <div class="settings-block-sub">Descarga un archivo con todo tu progreso o restaura uno guardado. Útil al cambiar de móvil o por seguridad.</div>

            <div class="settings-row">
                <div class="settings-row-info">
                    <div class="settings-row-label">Exportar todo</div>
                    <div class="settings-row-sub">Descarga un JSON con historial, fallos, dominadas, plan, récord y ajustes</div>
                </div>
                <button class="settings-action-btn" id="btn-export">Descargar</button>
            </div>

            <div class="settings-row">
                <div class="settings-row-info">
                    <div class="settings-row-label">Importar respaldo</div>
                    <div class="settings-row-sub">Selecciona un archivo previamente exportado. Sobrescribirá tus datos actuales.</div>
                </div>
                <label class="settings-action-btn" for="import-input">Seleccionar archivo</label>
                <input type="file" id="import-input" accept="application/json,.json" hidden>
            </div>
        </div>

        <div class="settings-block">
            <div class="settings-block-title">Acerca de</div>
            <div class="settings-block-sub">Banco de Preguntas AESF para maquinista de tren. ${state.preguntas.length} preguntas cargadas.</div>
        </div>
    `;

    $('#settings-content').innerHTML = html;
    mostrarPantalla('settings');

    setTimeout(() => cablearAjustes(), 0);
}

function cablearAjustes() {
    cargarVocesEnSelect();
    if ('speechSynthesis' in window) {
        speechSynthesis.onvoiceschanged = cargarVocesEnSelect;
    }

    const voiceRate = $('#voice-rate');
    const voiceRateVal = $('#voice-rate-val');
    if (voiceRate) {
        voiceRate.addEventListener('input', () => {
            voiceRateVal.textContent = parseFloat(voiceRate.value).toFixed(1) + 'x';
            const s = obtenerSettings();
            s.rate = parseFloat(voiceRate.value);
            guardarSettings(s);
        });
    }

    const voiceSelect = $('#voice-select');
    if (voiceSelect) {
        voiceSelect.addEventListener('change', () => {
            const s = obtenerSettings();
            s.voice = voiceSelect.value;
            guardarSettings(s);
        });
    }

    const voiceTest = $('#voice-test');
    if (voiceTest) {
        voiceTest.addEventListener('click', () => {
            hablar('Hola. Esta es una prueba de la lectura en voz alta. Si me oyes correctamente, la configuración está bien.');
        });
    }

    const confirmar = (titulo, msg, onYes) => {
        $('#confirm-title').textContent = titulo;
        $('#confirm-message').innerHTML = msg;
        $('#confirm-modal').hidden = false;
        const yes = $('#confirm-yes');
        const newYes = yes.cloneNode(true);
        yes.parentNode.replaceChild(newYes, yes);
        newYes.addEventListener('click', () => {
            $('#confirm-modal').hidden = true;
            onYes();
            cablearConfirmGenerico();
            abrirAjustes();
        });
        const no = $('#confirm-no');
        const newNo = no.cloneNode(true);
        no.parentNode.replaceChild(newNo, no);
        newNo.addEventListener('click', () => {
            $('#confirm-modal').hidden = true;
            cablearConfirmGenerico();
        });
    };

    $('#btn-clear-history')?.addEventListener('click', () =>
        confirmar('Borrar historial', '¿Borrar todo el historial de exámenes? No podrás recuperarlo.', borrarHistorial));

    $('#btn-clear-fails')?.addEventListener('click', () =>
        confirmar('Borrar fallos', '¿Borrar todas las preguntas marcadas como falladas? El modo "Repasar fallos" se quedará vacío.',
            () => localStorage.removeItem(CONFIG.STORAGE_KEYS.FAILS)));

    $('#btn-clear-dominadas')?.addEventListener('click', () =>
        confirmar('Borrar dominadas', '¿Quitar todas las preguntas marcadas como dominadas? Volverán a aparecer en Smart Study.', borrarDominadas));

    $('#btn-clear-record')?.addEventListener('click', () =>
        confirmar('Reiniciar récord', '¿Borrar tu récord de muerte súbita?',
            () => localStorage.removeItem(CONFIG.STORAGE_KEYS.RECORD_SD)));

    $('#btn-clear-seen')?.addEventListener('click', () =>
        confirmar('Borrar contador de vistas', '¿Resetear el contador de preguntas vistas? Esto afecta a Smart Study (todas pasarán a ser "nuevas").', borrarVistas));

    $('#btn-clear-all')?.addEventListener('click', () =>
        confirmar('⚠ Borrar TODO', '¿Estás seguro? Se borrará TODO: historial, fallos, dominadas, récord, vistas y ajustes. <strong>Esta acción es irreversible.</strong>', () => {
            Object.values(CONFIG.STORAGE_KEYS).forEach(k => {
                if (k !== CONFIG.STORAGE_KEYS.THEME) localStorage.removeItem(k);
            });
        }));

    // Exportar datos
    $('#btn-export')?.addEventListener('click', () => {
        exportarDatos();
    });

    // Importar datos
    $('#import-input')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            // Pedir confirmación antes de sobreescribir
            $('#confirm-title').textContent = 'Importar respaldo';
            $('#confirm-message').innerHTML = `¿Restaurar el respaldo <strong>${file.name}</strong>? Esto <strong>sobrescribirá</strong> tus datos actuales (historial, fallos, dominadas, plan, ajustes...).`;
            $('#confirm-modal').hidden = false;
            const yes = $('#confirm-yes');
            const newYes = yes.cloneNode(true);
            yes.parentNode.replaceChild(newYes, yes);
            newYes.addEventListener('click', () => {
                $('#confirm-modal').hidden = true;
                const r = importarDatos(ev.target.result);
                if (r.ok) {
                    alert(`Respaldo restaurado: ${r.restaurados} categorías importadas.\nRecargando la app para aplicar los cambios...`);
                    location.reload();
                } else {
                    alert('Error al importar: ' + r.error);
                    cablearConfirmGenerico();
                }
            });
            const no = $('#confirm-no');
            const newNo = no.cloneNode(true);
            no.parentNode.replaceChild(newNo, no);
            newNo.addEventListener('click', () => {
                $('#confirm-modal').hidden = true;
                cablearConfirmGenerico();
                $('#import-input').value = ''; // limpiar selección
            });
        };
        reader.onerror = () => alert('No se pudo leer el archivo.');
        reader.readAsText(file);
    });
}

function cablearConfirmGenerico() {
    const yes = $('#confirm-yes');
    const newYes = yes.cloneNode(true);
    yes.parentNode.replaceChild(newYes, yes);
    newYes.addEventListener('click', () => {
        $('#confirm-modal').hidden = true;
        finalizarExamen();
    });
    const no = $('#confirm-no');
    const newNo = no.cloneNode(true);
    no.parentNode.replaceChild(newNo, no);
    newNo.addEventListener('click', () => {
        $('#confirm-modal').hidden = true;
    });
}

// ============================================================
// MODAL DE ATAJOS
// ============================================================
function abrirAtajos() { $('#shortcuts-modal').hidden = false; }
function cerrarAtajos() { $('#shortcuts-modal').hidden = true; }

// Modal al cruzar a sección de Específicas
function mostrarAvisoSeccionEspecificas() {
    const modal = $('#section-transition-modal');
    if (!modal) return;
    modal.hidden = false;
    // Pequeño efecto sonoro/táctil opcional
    if (navigator.vibrate) navigator.vibrate(120);
}

function cerrarAvisoSeccionEspecificas() {
    $('#section-transition-modal').hidden = true;
}

// ============================================================
// LECTURA EN VOZ ALTA
// ============================================================
function cargarVocesEnSelect() {
    if (!('speechSynthesis' in window)) return;
    const select = $('#voice-select');
    if (!select) return;
    const voces = speechSynthesis.getVoices();
    const settings = obtenerSettings();
    const spanishVoices = voces.filter(v => v.lang.toLowerCase().startsWith('es'));
    const otrasVoces = voces.filter(v => !v.lang.toLowerCase().startsWith('es'));
    const ordenadas = [...spanishVoices, ...otrasVoces];

    if (ordenadas.length === 0) {
        select.innerHTML = '<option>(No hay voces disponibles)</option>';
        return;
    }

    select.innerHTML = ordenadas.map(v =>
        `<option value="${v.name}" ${v.name === settings.voice ? 'selected' : ''}>${v.name} — ${v.lang}</option>`
    ).join('');

    if (!settings.voice && spanishVoices.length > 0) {
        select.value = spanishVoices[0].name;
        settings.voice = spanishVoices[0].name;
        guardarSettings(settings);
    }
}

function hablar(texto) {
    if (!('speechSynthesis' in window)) {
        alert('Tu navegador no soporta lectura en voz alta.');
        return;
    }
    pararAudio();
    const settings = obtenerSettings();
    const u = new SpeechSynthesisUtterance(texto);
    u.rate = settings.rate || 1;
    u.pitch = settings.pitch || 1;
    u.lang = 'es-ES';
    const voces = speechSynthesis.getVoices();
    if (settings.voice) {
        const v = voces.find(v => v.name === settings.voice);
        if (v) u.voice = v;
    } else {
        const esES = voces.find(v => v.lang.toLowerCase().startsWith('es'));
        if (esES) u.voice = esES;
    }
    u.onstart = () => $('#audio-btn')?.classList.add('is-playing');
    u.onend = () => $('#audio-btn')?.classList.remove('is-playing');
    u.onerror = () => $('#audio-btn')?.classList.remove('is-playing');
    speechSynthesis.speak(u);
}

function pararAudio() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    $('#audio-btn')?.classList.remove('is-playing');
}

function leerPreguntaActual() {
    if (!state.quiz) return;
    const pregunta = state.quiz.preguntas[state.quiz.indice];
    if (!pregunta) return;
    let texto = pregunta.enunciado + '. ';
    Object.entries(pregunta.opciones).forEach(([letra, txt]) => {
        texto += `Opción ${letra}. ${txt}. `;
    });
    hablar(texto);
}

// ============================================================
// FILTROS AVANZADOS DEL BUSCADOR
// ============================================================
let filtrosBusqueda = {
    categoria: { reglamento: true, especifica: true },
    temas: new Set(),
    conImagen: 'todas',
    estado: 'todas',
};

function renderFiltrosBusqueda() {
    const cont = $('#search-filters-content');
    const temasReg = state.temasDisponibles.reglamento;
    const temasEsp = state.temasDisponibles.especifica;

    let html = `<div class="filter-group">
        <div class="filter-group-title">Categoría</div>
        <label class="filter-check"><input type="checkbox" data-fcat="reglamento" ${filtrosBusqueda.categoria.reglamento ? 'checked' : ''}> Reglamento <span class="filter-count">${state.preguntas.filter(p => p.categoria === 'reglamento').length}</span></label>
        <label class="filter-check"><input type="checkbox" data-fcat="especifica" ${filtrosBusqueda.categoria.especifica ? 'checked' : ''}> Específicas <span class="filter-count">${state.preguntas.filter(p => p.categoria === 'especifica').length}</span></label>
    </div>`;

    if (temasReg.length > 0 || temasEsp.length > 0) {
        html += `<div class="filter-group">
            <div class="filter-group-title">Temas</div>`;
        [...temasReg, ...temasEsp].forEach(t => {
            const checked = filtrosBusqueda.temas.has(t.nombre) ? 'checked' : '';
            html += `<label class="filter-check"><input type="checkbox" data-ftema="${t.nombre.replace(/"/g, '&quot;')}" ${checked}> ${t.nombre} <span class="filter-count">${t.count}</span></label>`;
        });
        html += `</div>`;
    }

    html += `<div class="filter-group">
        <div class="filter-group-title">Con imagen</div>
        <label class="filter-check"><input type="radio" name="fimg" value="todas" ${filtrosBusqueda.conImagen === 'todas' ? 'checked' : ''}> Todas</label>
        <label class="filter-check"><input type="radio" name="fimg" value="si" ${filtrosBusqueda.conImagen === 'si' ? 'checked' : ''}> Con imagen</label>
        <label class="filter-check"><input type="radio" name="fimg" value="no" ${filtrosBusqueda.conImagen === 'no' ? 'checked' : ''}> Sin imagen</label>
    </div>`;

    html += `<div class="filter-group">
        <div class="filter-group-title">Estado</div>
        <label class="filter-check"><input type="radio" name="festado" value="todas" ${filtrosBusqueda.estado === 'todas' ? 'checked' : ''}> Todas</label>
        <label class="filter-check"><input type="radio" name="festado" value="falladas" ${filtrosBusqueda.estado === 'falladas' ? 'checked' : ''}> Solo falladas</label>
        <label class="filter-check"><input type="radio" name="festado" value="dominadas" ${filtrosBusqueda.estado === 'dominadas' ? 'checked' : ''}> Solo dominadas</label>
        <label class="filter-check"><input type="radio" name="festado" value="nuevas" ${filtrosBusqueda.estado === 'nuevas' ? 'checked' : ''}> Nunca vistas</label>
    </div>`;

    cont.innerHTML = html;

    cont.querySelectorAll('input').forEach(input => {
        input.addEventListener('change', () => {
            if (input.dataset.fcat) {
                filtrosBusqueda.categoria[input.dataset.fcat] = input.checked;
            } else if (input.dataset.ftema) {
                if (input.checked) filtrosBusqueda.temas.add(input.dataset.ftema);
                else filtrosBusqueda.temas.delete(input.dataset.ftema);
            } else if (input.name === 'fimg') {
                filtrosBusqueda.conImagen = input.value;
            } else if (input.name === 'festado') {
                filtrosBusqueda.estado = input.value;
            }
            actualizarBadgeFiltros();
            renderResultadosBusqueda($('#search-input').value);
        });
    });
}

function aplicarFiltros(preguntas) {
    const fallos = obtenerFallosGuardados();
    const dominadas = obtenerDominadas();
    const vistas = obtenerVistas();

    return preguntas.filter(p => {
        if (!filtrosBusqueda.categoria[p.categoria]) return false;
        if (filtrosBusqueda.temas.size > 0 && !filtrosBusqueda.temas.has(p.tema)) return false;
        if (filtrosBusqueda.conImagen === 'si' && !p.imagen) return false;
        if (filtrosBusqueda.conImagen === 'no' && p.imagen) return false;
        if (filtrosBusqueda.estado === 'falladas' && !fallos[p.id]) return false;
        if (filtrosBusqueda.estado === 'dominadas' && !dominadas[p.id]) return false;
        if (filtrosBusqueda.estado === 'nuevas' && vistas[p.id]) return false;
        return true;
    });
}

function contarFiltrosActivos() {
    let n = 0;
    if (!filtrosBusqueda.categoria.reglamento || !filtrosBusqueda.categoria.especifica) n++;
    if (filtrosBusqueda.temas.size > 0) n++;
    if (filtrosBusqueda.conImagen !== 'todas') n++;
    if (filtrosBusqueda.estado !== 'todas') n++;
    return n;
}

function actualizarBadgeFiltros() {
    const n = contarFiltrosActivos();
    const badge = $('#search-filter-badge');
    if (n > 0) {
        badge.hidden = false;
        badge.textContent = n;
        $('#search-filter-toggle').classList.add('is-active');
    } else {
        badge.hidden = true;
        $('#search-filter-toggle').classList.remove('is-active');
    }
}

function resetearFiltros() {
    filtrosBusqueda = {
        categoria: { reglamento: true, especifica: true },
        temas: new Set(),
        conImagen: 'todas',
        estado: 'todas',
    };
    renderFiltrosBusqueda();
    actualizarBadgeFiltros();
    renderResultadosBusqueda($('#search-input').value);
}


function cablearEventos() {
    // Logo → home
    $('#btn-home').addEventListener('click', irAHome);

    // Botones de cabecera
    $('#btn-plan').addEventListener('click', abrirPlan);
    $('#btn-stats').addEventListener('click', abrirEstadisticas);
    $('#btn-shortcuts').addEventListener('click', abrirAtajos);
    $('#btn-settings').addEventListener('click', abrirAjustes);

    // Modal de atajos
    $('#shortcuts-close').addEventListener('click', cerrarAtajos);
    $('#shortcuts-modal').addEventListener('click', (e) => {
        if (e.target === $('#shortcuts-modal')) cerrarAtajos();
    });

    // Modal de transición a sección de específicas
    $('#section-transition-close').addEventListener('click', cerrarAvisoSeccionEspecificas);

    // Botón de audio en quiz
    $('#audio-btn').addEventListener('click', () => {
        if ($('#audio-btn').classList.contains('is-playing')) {
            pararAudio();
        } else {
            leerPreguntaActual();
        }
    });

    // Toggle de filtros del buscador
    $('#search-filter-toggle').addEventListener('click', () => {
        const filters = $('#search-filters');
        const layout = $('.search-layout');
        const visible = !filters.hidden;
        if (visible) {
            filters.hidden = true;
            layout.classList.remove('with-filters');
        } else {
            filters.hidden = false;
            layout.classList.add('with-filters');
            renderFiltrosBusqueda();
        }
    });

    // Botón resetear filtros
    $('#filter-reset').addEventListener('click', resetearFiltros);

    // Tarjetas de modo
    $$('.mode-card[data-mode]').forEach(card => {
        card.addEventListener('click', () => {
            if (card.disabled || card.classList.contains('mode-card--disabled')) return;
            const modo = card.dataset.mode;
            abrirConfiguracion(modo);
        });
    });

    // Botón "Volver" de configuración
    $$('.back-btn').forEach(btn => {
        btn.addEventListener('click', irAHome);
    });

    // Botón comenzar sesión
    $('#btn-start').addEventListener('click', () => {
        if (!$('#btn-start').disabled) comenzarSesion();
    });

    // Botón generar PDF
    $('#btn-generate-pdf').addEventListener('click', () => {
        if (!$('#btn-generate-pdf').disabled) generarPDF();
    });

    // CTA grande para modos infinitos
    $('#quiz-next-cta').addEventListener('click', () => {
        const q = state.quiz;
        if (!q) return;
        if (q.modoQuiz === 'infinitas' || q.modoQuiz === 'muerte-subita') {
            siguienteEnInfinitas();
        }
    });

    // Botón "Terminar" del contador flotante (infinitas)
    $('#fc-end').addEventListener('click', () => {
        const q = state.quiz;
        if (!q) return;
        if (q.modoQuiz === 'infinitas') {
            // Mostrar resumen simple
            mostrarResumenInfinitas();
        } else if (q.modoQuiz === 'muerte-subita') {
            // Terminar voluntariamente = guardar racha actual
            guardarRecordSD(q.aciertos);
            finalizarMuerteSubita();
        }
    });

    // Buscador
    const searchInput = $('#search-input');
    if (searchInput) {
        let searchTimer = null;
        searchInput.addEventListener('input', () => {
            const val = searchInput.value;
            $('#search-clear').hidden = !val;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => renderResultadosBusqueda(val), 150);
        });
        $('#search-clear').addEventListener('click', () => {
            searchInput.value = '';
            $('#search-clear').hidden = true;
            renderResultadosBusqueda('');
            searchInput.focus();
        });
    }

    // Volver desde detalle al buscador
    $('#btn-back-search').addEventListener('click', () => mostrarPantalla('search'));

    // Quiz: anterior, siguiente
    $('#btn-prev').addEventListener('click', () => navegar(-1));
    $('#btn-next').addEventListener('click', () => navegar(1));

    // Banderita
    $('#flag-btn').addEventListener('click', toggleBanderita);

    // Finalizar examen
    $('#btn-finish').addEventListener('click', pedirConfirmacionFinalizar);
    $('#confirm-yes').addEventListener('click', () => {
        $('#confirm-modal').hidden = true;
        finalizarExamen();
    });
    $('#confirm-no').addEventListener('click', () => {
        $('#confirm-modal').hidden = true;
    });

    // Imagen ampliada
    $('#quiz-image-btn').addEventListener('click', abrirImagenAmpliada);
    $('#image-modal-close').addEventListener('click', cerrarImagenAmpliada);
    $('#image-modal').addEventListener('click', (e) => {
        if (e.target === $('#image-modal')) cerrarImagenAmpliada();
    });

    // Tecla ESC cierra modales
    document.addEventListener('keydown', (e) => {
        // No procesar atajos si está escribiendo en un input
        const enInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

        if (e.key === 'Escape') {
            if (!$('#image-modal').hidden) cerrarImagenAmpliada();
            if (!$('#confirm-modal').hidden) $('#confirm-modal').hidden = true;
            if (!$('#shortcuts-modal').hidden) cerrarAtajos();
            if (!$('#section-transition-modal').hidden) cerrarAvisoSeccionEspecificas();
            $('#quiz-nav').classList.remove('is-open');
            // Cerrar filtros del buscador en móvil
            if (!$('#search-filters').hidden && window.matchMedia('(max-width: 980px)').matches) {
                $('#search-filters').hidden = true;
                $('.search-layout').classList.remove('with-filters');
            }
        }

        // Atajos globales (no en inputs)
        if (!enInput) {
            // ? → abrir/cerrar atajos
            if (e.key === '?' || (e.shiftKey && e.key === '/')) {
                e.preventDefault();
                if ($('#shortcuts-modal').hidden) abrirAtajos();
                else cerrarAtajos();
                return;
            }
            // H → ir al inicio (si no estamos ya, y si no hay examen en curso con timer)
            if (e.key.toUpperCase() === 'H' && !state.quiz?.conTimer) {
                if ($('#screen-home').hidden) {
                    irAHome();
                    return;
                }
            }
        }

        // Atajos de teclado en quiz
        if (!$('#screen-quiz').hidden && state.quiz && !state.quiz.finalizado) {
            const q = state.quiz;
            const pregunta = q.preguntas[q.indice];

            // Flechas izq/der → navegar (solo si es navegable)
            if (q.navegableLibre) {
                if (e.key === 'ArrowLeft' && !$('#btn-prev').disabled) { navegar(-1); }
                if (e.key === 'ArrowRight' && !$('#btn-next').disabled) { navegar(1); }
            }

            // Enter o Espacio → pasar a siguiente en modos infinitos (si ya respondió)
            if ((e.key === 'Enter' || e.key === ' ') &&
                (q.modoQuiz === 'infinitas' || q.modoQuiz === 'muerte-subita')) {
                if (q.corregidas[pregunta.id]) {
                    e.preventDefault();
                    const cta = $('#quiz-next-cta');
                    if (cta.classList.contains('is-visible')) {
                        siguienteEnInfinitas();
                    }
                }
            }

            // Letras A/B/C/D para responder
            const tecla = e.key.toUpperCase();
            if (['A', 'B', 'C', 'D'].includes(tecla) && pregunta.opciones[tecla]) {
                if (!q.corregidas[pregunta.id] && q.modoQuiz !== 'repaso') {
                    onSeleccionarOpcion(tecla);
                }
            }

            // Números 1/2/3/4 → equivalente a A/B/C/D
            const mapNum = { '1': 'A', '2': 'B', '3': 'C', '4': 'D' };
            if (mapNum[e.key] && pregunta.opciones[mapNum[e.key]]) {
                if (!q.corregidas[pregunta.id] && q.modoQuiz !== 'repaso') {
                    onSeleccionarOpcion(mapNum[e.key]);
                }
            }

            // F → marcar banderita
            if (tecla === 'F' && q.mostrarBanderitas) toggleBanderita();

            // V → leer en voz alta
            if (tecla === 'V') {
                e.preventDefault();
                if ($('#audio-btn').classList.contains('is-playing')) {
                    pararAudio();
                } else {
                    leerPreguntaActual();
                }
            }
        }
    });

    // Nav móvil
    $('#nav-mobile-toggle').addEventListener('click', () => {
        $('#quiz-nav').classList.toggle('is-open');
    });

    // Pantalla de resultados
    $('#btn-new-exam').addEventListener('click', irAHome);
    $('#btn-review-answers').addEventListener('click', revisarRespuestas);

    // Guardar sesión y avisar al salir
    window.addEventListener('beforeunload', (e) => {
        // Snapshot final por si pierdes contenido
        if (state.quiz && !state.quiz.finalizado) {
            guardarSesionActiva();
        }
        // Solo bloquear el cierre si es examen con timer
        if (state.quiz && state.quiz.conTimer && !state.quiz.finalizado) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // Guardar también al pasar a segundo plano (móvil bloquea apps en background)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && state.quiz && !state.quiz.finalizado) {
            guardarSesionActiva();
        }
    });
}

// ============================================================
// ARRANQUE
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    inicializarTema();
    cablearEventos();
    cargarBanco();
});
