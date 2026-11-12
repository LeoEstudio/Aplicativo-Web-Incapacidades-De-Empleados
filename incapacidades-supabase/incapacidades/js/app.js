// ============================================================================
// CONFIGURACIÓN DE CAMPOS Y ENCABEZADOS
// Nota: Las claves internas (empresa, fIni, fFin, etc.) se mantienen igual
// para conservar compatibilidad con js/ocr.js y los IDs del formulario HTML.
// ============================================================================

// Estructura: [clave, etiqueta, tipo, grupoHTML, opciones]
const CAMPOS = [
  ["empresa", "Empresa", "text", "g1"],
  ["nombre", "Nombre del trabajador", "text", "g1"],
  ["cedula", "Cédula", "text", "g1"],
  ["genero", "Género", "sel", "g1", ["Femenino", "Masculino", "Otro"]],

  ["motivo", "Motivo de consulta", "text", "g2"],
  ["lugar", "Lugar de atención", "text", "g2"],
  ["eps", "Nombre de EPS/ARL", "text", "g2"],
  ["medico", "Médico tratante", "text", "g2"],
  ["especialidad", "Especialidad", "text", "g2"],
  [
    "evento",
    "Tipo de evento",
    "sel",
    "g2",
    [
      "Enfermedad general",
      "Accidente de trabajo",
      "Enfermedad laboral",
      "Accidente común",
      "Licencia de maternidad",
      "Licencia de paternidad",
      "Otro"
    ]
  ],

  ["fAt", "Fecha de atención", "date", "g3"],
  ["fIni", "Fecha inicio", "date", "g3"],
  ["fFin", "Fecha fin", "date", "g3"],
  ["dias", "Total días (se calcula)", "number", "g3"],

  ["dx1", "Diagnóstico principal (CIE-10)", "text", "g4"],
  ["dx2", "Diagnóstico secundario (CIE-10)", "text", "g4"],
  ["meds", "Medicamentos", "area", "g4"],
  ["plan", "Plan de manejo", "area", "g4"],
  ["restr", "Restricciones médicas", "area", "g4"],
  ["recom", "Recomendaciones médicas", "area", "g4"],
  ["remis", "Remisiones", "area", "g4"]
];

// Encabezados exactos para exportar el archivo CSV
const ENCABEZADOS_CSV = [
  "MES DE ATENCIÓN",
  "EMPRESA",
  "NOMBRE DEL TRABAJADOR",
  "CEDULA",
  "GENERO",
  "MOTIVO DE CONSULTA",
  "LUGAR DE ATENCIÓN",
  "NOMBRE DE EPS/ARL",
  "NOMBRE DEL MEDICO TRATANTE",
  "ESPECIALIDAD",
  "TIPO DE EVENTO",
  "FECHA DE ATENCIÓN",
  "FECHA INICIO",
  "FECHA FIN",
  "TOTAL DIAS",
  "DIAGNOSTICO PRINCIPAL (CODIGO CIE - 10)",
  "DIAGNOSTICO SECUNDARIO (CODIGO CIE - 10)",
  "MEDICAMENTOS",
  "PLAN DE MANEJO",
  "RESTRICCIONES MÉDICAS",
  "RECOMENDACIONES MEDICAS",
  "REMISIONES"
];

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

// Mapeo entre claves del formulario y nombres de columnas en Supabase
const MAPA_COLUMNAS_DB = {
  eps: "eps_arl",
  medico: "medico_tratante",
  evento: "tipo_evento",
  fAt: "fecha_atencion",
  fIni: "fecha_inicio",
  fFin: "fecha_fin",
  dias: "total_dias",
  dx1: "dx_principal",
  dx2: "dx_secundario",
  meds: "medicamentos",
  plan: "plan_manejo",
  restr: "restricciones",
  recom: "recomendaciones",
  remis: "remisiones"
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const BUCKET_SOPORTES = "incapacidades-pdf";
const MAX_SOPORTE_MB = 10;
const TIPOS_SOPORTE = /^(application\/pdf|image\/(jpeg|png|webp))$/;

const selector = (css) => document.querySelector(css);
const obtenerInputCampo = (clave) => selector("#f_" + clave);

let registros = [];
let idEdicion = null;
let supabaseCliente = null;

// ============================================================================
// UTILIDADES Y CONVERSIÓN DE DATOS
// ============================================================================

function convertirParaDB(datos) {
  const fila = {};
  CAMPOS.forEach(([clave]) => {
    const valor = datos[clave];
    const columna = MAPA_COLUMNAS_DB[clave] || clave;
    if (valor === "" || valor == null) {
      fila[columna] = null;
    } else if (clave === "dias") {
      fila[columna] = Number(valor);
    } else {
      fila[columna] = valor;
    }
  });
  return fila;
}

function convertirDesdeDB(filaDB) {
  const registro = { id: filaDB.id };
  CAMPOS.forEach(([clave]) => {
    const columna = MAPA_COLUMNAS_DB[clave] || clave;
    registro[clave] = filaDB[columna] ?? "";
  });
  registro.pdfPath = filaDB.pdf_path || null;
  registro.pdfNombre = filaDB.pdf_nombre || null;
  return registro;
}

const rutasSoporte = () => new Set(registros.map((r) => r.pdfPath).filter(Boolean));

async function cargarRegistros() {
  const rutasAntes = rutasSoporte();

  const { data, error } = await supabaseCliente
    .from("incapacidades")
    .select("*")
    .order("fecha_inicio", { ascending: false });

  if (error) {
    mostrarToast("No se pudieron cargar los registros: " + error.message);
    return;
  }
  registros = data.map(convertirDesdeDB);

  // Limpieza: borra de Storage los archivos que ya ningún registro usa
  // (registro borrado, soporte reemplazado o quitado). Verifica antes de borrar.
  const rutasAhora = rutasSoporte();
  for (const ruta of [...rutasAntes].filter((r) => !rutasAhora.has(r))) {
    const { count, error: errorConteo } = await supabaseCliente
      .from("incapacidades")
      .select("id", { count: "exact", head: true })
      .eq("pdf_path", ruta);
    if (!errorConteo && count === 0) {
      await supabaseCliente.storage.from(BUCKET_SOPORTES).remove([ruta]);
    }
  }
}

function mostrarToast(mensaje) {
  const elemento = selector("#toast");
  elemento.textContent = mensaje;
  elemento.style.display = "block";
  clearTimeout(mostrarToast.temporizador);
  mostrarToast.temporizador = setTimeout(() => {
    elemento.style.display = "none";
  }, 3500);
}

function escaparHTML(texto) {
  return String(texto ?? "").replace(/[&<>"]/g, (caracter) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  }[caracter]));
}

function obtenerNombreMes(fechaISO) {
  if (!fechaISO) return "";
  const indiceMes = Number(fechaISO.slice(5, 7)) - 1;
  return MESES[indiceMes] || "";
}

function calcularDias(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return "";
  const diferenciaMs = new Date(fechaFin) - new Date(fechaInicio);
  return Math.round(diferenciaMs / MS_POR_DIA) + 1;
}

// ============================================================================
// CONSTRUCCIÓN Y MANEJO DEL FORMULARIO
// ============================================================================

function crearCampoHTML(clave, etiqueta, tipo, opciones) {
  const id = "f_" + clave;
  const claseContenedor = tipo === "area" ? ' class="wide"' : "";
  let html = `<div${claseContenedor}><label for="${id}">${etiqueta}</label>`;

  if (tipo === "sel") {
    const opcionesHTML = opciones.map((opt) => `<option>${opt}</option>`).join("");
    html += `<select id="${id}" data-k="${clave}"><option value=""></option>${opcionesHTML}</select>`;
  } else if (tipo === "area") {
    html += `<textarea id="${id}" data-k="${clave}"></textarea>`;
  } else {
    const atributoMin = clave === "dias" ? " min=0" : "";
    html += `<input id="${id}" data-k="${clave}" type="${tipo}"${atributoMin}>`;
  }

  return html + "</div>";
}

// Insertar los campos en los contenedores g1, g2, g3, g4
CAMPOS.forEach(([clave, etiqueta, tipo, grupo, opciones]) => {
  selector("#" + grupo).insertAdjacentHTML(
    "beforeend",
    crearCampoHTML(clave, etiqueta, tipo, opciones)
  );
});

function llenarFormulario(datos, resaltarParaRevision = false) {
  CAMPOS.forEach(([clave, , tipo]) => {
    const input = obtenerInputCampo(clave);
    const valor = datos[clave] ?? "";

    if (tipo === "sel" && valor && ![...input.options].some((opt) => opt.value === valor)) {
      input.add(new Option(valor, valor));
    }

    input.value = valor;
    input.classList.toggle("rv", Boolean(resaltarParaRevision && valor));
  });
}

function leerFormulario() {
  const datos = {};
  CAMPOS.forEach(([clave]) => {
    datos[clave] = obtenerInputCampo(clave).value.trim();
  });
  return datos;
}

// Cálculo automático de días al cambiar Fecha inicio o Fecha fin
document.addEventListener("input", (evento) => {
  const clave = evento.target.dataset?.k;
  if (!clave) return;

  evento.target.classList.remove("rv");

  if (clave === "fIni" || clave === "fFin") {
    const totalDias = calcularDias(
      obtenerInputCampo("fIni").value,
      obtenerInputCampo("fFin").value
    );
    if (totalDias !== "" && totalDias > 0) {
      obtenerInputCampo("dias").value = totalDias;
    }
  }
});

// ============================================================================
// SOPORTE DE LA EPS: PDF (o imagen) guardado junto al registro
// Va directo del navegador a Supabase Storage; no depende del servidor de Gemini.
// ============================================================================

// soporte.path: archivo del registro; soporte.pendiente: subido pero aún sin guardar;
// soporte.cambio: el usuario adjuntó o quitó algo (se escribe en la base al guardar)
const soporteVacio = () => ({ path: null, nombre: null, tam: 0, cambio: false, pendiente: null, subiendo: false });
let soporte = soporteVacio();

const almacenSoportes = () => supabaseCliente.storage.from(BUCKET_SOPORTES);
const formatearTamano = (n) =>
  n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";

document.head.insertAdjacentHTML("beforeend", `<style>
  .sop{border:2px dashed var(--ac);background:var(--acs);border-radius:8px;padding:18px;text-align:center;cursor:pointer}
  .sop.arrastre{background:var(--bg);border-style:solid}.sop small{color:var(--mut)}
  .sopAcc{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}</style>`);

selector("#g4").insertAdjacentHTML("afterend", `
  <h2 style="margin-top:18px">Soporte de la EPS (PDF de la incapacidad)</h2>
  <div class="sop" id="sopZona" tabindex="0" role="button" aria-label="Cargar el PDF de la incapacidad">
    <input type="file" id="sopInput" accept="application/pdf,image/jpeg,image/png,image/webp" hidden>
    <div id="sopTexto"></div>
  </div>
  <div class="sopAcc">
    <button class="btn sec" type="button" id="sopVer" hidden>Ver archivo</button>
    <button class="btn del" type="button" id="sopQuitar" hidden>Quitar</button>
  </div>`);

function pintarSoporte() {
  const hay = Boolean(soporte.path);
  selector("#sopTexto").innerHTML = soporte.subiendo
    ? "Subiendo archivo…"
    : hay
      ? `<b>${escaparHTML(soporte.nombre || "Archivo guardado")}</b>${soporte.tam ? " · " + formatearTamano(soporte.tam) : ""}<br><small>Haz clic o arrastra otro archivo para reemplazarlo</small>`
      : `Arrastra aquí el PDF de la incapacidad<br><small>o haz clic para elegirlo (PDF o imagen, máx. ${MAX_SOPORTE_MB} MB)</small>`;
  selector("#sopVer").hidden = !hay;
  selector("#sopQuitar").hidden = !hay;
}

// Borra de Storage el archivo subido en esta sesión que nunca se guardó
async function descartarSoportePendiente() {
  const ruta = soporte.pendiente;
  soporte.pendiente = null;
  if (ruta) await almacenSoportes().remove([ruta]);
}

async function subirSoporte(archivo) {
  if (!archivo) return;
  if (!TIPOS_SOPORTE.test(archivo.type)) {
    return mostrarToast("Solo se admiten PDF o imágenes (JPG, PNG, WEBP).");
  }
  if (archivo.size > MAX_SOPORTE_MB * 1048576) {
    return mostrarToast(`El archivo supera ${MAX_SOPORTE_MB} MB.`);
  }

  soporte.subiendo = true;
  pintarSoporte();

  const nombreLimpio = archivo.name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.\-]+/g, "_");
  const ruta = `${crypto.randomUUID()}/${nombreLimpio}`;
  const { error } = await almacenSoportes().upload(ruta, archivo, { contentType: archivo.type });

  soporte.subiendo = false;
  if (error) {
    pintarSoporte();
    return mostrarToast("No se pudo subir el archivo: " + error.message);
  }

  await descartarSoportePendiente();
  Object.assign(soporte, { path: ruta, nombre: archivo.name, tam: archivo.size, cambio: true, pendiente: ruta });
  pintarSoporte();
}

async function verSoporte(ruta) {
  if (!ruta) return;
  const ventana = window.open("", "_blank"); // se abre antes del await para evitar el bloqueo de pop-ups
  const { data, error } = await almacenSoportes().createSignedUrl(ruta, 300);
  if (error) {
    if (ventana) ventana.close();
    return mostrarToast("No se pudo abrir el archivo: " + error.message);
  }
  ventana ? (ventana.location.href = data.signedUrl) : window.open(data.signedUrl);
}

function cargarSoporteDeRegistro(registro) {
  descartarSoportePendiente();
  soporte = { ...soporteVacio(), path: registro.pdfPath, nombre: registro.pdfNombre };
  pintarSoporte();
}

const zonaSoporte = selector("#sopZona");
const inputSoporte = selector("#sopInput");

zonaSoporte.onclick = () => inputSoporte.click();
zonaSoporte.onkeydown = (evento) => {
  if (evento.key === "Enter" || evento.key === " ") {
    evento.preventDefault();
    inputSoporte.click();
  }
};
inputSoporte.onchange = () => {
  subirSoporte(inputSoporte.files[0]);
  inputSoporte.value = "";
};
["dragenter", "dragover"].forEach((nombre) =>
  zonaSoporte.addEventListener(nombre, (e) => { e.preventDefault(); zonaSoporte.classList.add("arrastre"); })
);
["dragleave", "drop"].forEach((nombre) =>
  zonaSoporte.addEventListener(nombre, (e) => { e.preventDefault(); zonaSoporte.classList.remove("arrastre"); })
);
zonaSoporte.addEventListener("drop", (e) => subirSoporte(e.dataTransfer.files[0]));

selector("#sopVer").onclick = () => verSoporte(soporte.path);
selector("#sopQuitar").onclick = async () => {
  await descartarSoportePendiente();
  Object.assign(soporte, { path: null, nombre: null, tam: 0, cambio: true });
  pintarSoporte();
};

pintarSoporte();

// ============================================================================
// GUARDAR / ACTUALIZAR / LIMPIAR
// ============================================================================

selector("#f").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const datos = leerFormulario();

  if (!datos.nombre || !datos.cedula || !datos.fIni || !datos.fFin) {
    mostrarToast("Faltan nombre, cédula y las fechas de inicio y fin.");
    return;
  }
  if (datos.fFin < datos.fIni) {
    mostrarToast("La fecha fin no puede ser anterior a la fecha inicio.");
    return;
  }
  if (soporte.subiendo) {
    mostrarToast("Espera a que termine de subir el archivo.");
    return;
  }

  if (!datos.dias) {
    datos.dias = calcularDias(datos.fIni, datos.fFin);
  }
  datos.cedula = datos.cedula.replace(/[^\dA-Za-z]/g, "");

  const botonGuardar = selector("#save");
  const cuerpoDB = convertirParaDB(datos);
  if (soporte.cambio) {
    cuerpoDB.pdf_path = soporte.path;
    cuerpoDB.pdf_nombre = soporte.nombre;
  }
  const estaEditando = Boolean(idEdicion);

  botonGuardar.disabled = true;

  const { error } = estaEditando
    ? await supabaseCliente.from("incapacidades").update(cuerpoDB).eq("id", idEdicion)
    : await supabaseCliente.from("incapacidades").insert(cuerpoDB);

  botonGuardar.disabled = false;

  if (error) {
    mostrarToast("No se pudo guardar: " + error.message);
    return;
  }

  soporte.pendiente = null; // ya quedó referenciado en la base: no se descarta
  await cargarRegistros();  // también borra de Storage el archivo reemplazado o quitado
  mostrarToast(estaEditando ? "Cambios guardados." : "Incapacidad guardada.");
  reiniciarFormulario();
});

function reiniciarFormulario() {
  idEdicion = null;
  llenarFormulario({});
  selector("#rvhint").hidden = true;
  selector("#ocrmsg").textContent = "";
  selector("#save").textContent = "Guardar incapacidad";
  selector("#file").value = "";
  soporte = soporteVacio();
  pintarSoporte();
}

// "Limpiar" cancela: descarta también el archivo subido que no se guardó
selector("#clr").onclick = async () => {
  await descartarSoportePendiente();
  reiniciarFormulario();
};

// ============================================================================
// NAVEGACIÓN ENTRE VISTAS
// ============================================================================

function mostrarVista(vistaActiva) {
  ["reg", "lst", "res"].forEach((vista) => {
    selector("#" + vista).hidden = vista !== vistaActiva;
  });
  document.querySelectorAll("nav button").forEach((boton) => {
    boton.setAttribute("aria-selected", boton.dataset.v === vistaActiva);
  });

  if (vistaActiva === "lst") renderizarLista();
  if (vistaActiva === "res") renderizarResumen();
}

document.querySelectorAll("nav button").forEach((boton) => {
  boton.onclick = () => mostrarVista(boton.dataset.v);
});

// ============================================================================
// FILTROS Y LISTADO DE INCAPACIDADES
// ============================================================================

const FILTROS = [
  ["q", "Buscar (nombre o cédula)", "text"],
  ["empresa", "Empresa", "sel"],
  ["eps", "EPS/ARL", "sel"],
  ["evento", "Tipo de evento", "sel"],
  ["genero", "Género", "sel"],
  ["desde", "Fecha inicio desde", "date"],
  ["hasta", "Fecha inicio hasta", "date"]
];

selector("#flt").innerHTML = FILTROS.map(([clave, etiqueta, tipo]) => {
  const control = tipo === "sel"
    ? `<select id="x_${clave}"></select>`
    : `<input id="x_${clave}" type="${tipo}">`;
  return `<div><label for="x_${clave}">${etiqueta}</label>${control}</div>`;
}).join("");

const obtenerValorFiltro = (clave) => selector("#x_" + clave).value;

function actualizarOpcionesFiltros() {
  ["empresa", "eps", "evento", "genero"].forEach((clave) => {
    const select = selector("#x_" + clave);
    const valorActual = select.value;
    const valoresUnicos = [...new Set(registros.map((r) => r[clave]).filter(Boolean))].sort();

    select.innerHTML =
      '<option value="">Todos</option>' +
      valoresUnicos.map((val) => `<option>${escaparHTML(val)}</option>`).join("");

    select.value = valoresUnicos.includes(valorActual) ? valorActual : "";
  });
}

function filtrarRegistros() {
  const textoBusqueda = obtenerValorFiltro("q").toLowerCase();

  return registros
    .filter((reg) => {
      const coincideTexto =
        !textoBusqueda ||
        (reg.nombre || "").toLowerCase().includes(textoBusqueda) ||
        (reg.cedula || "").includes(textoBusqueda);

      const coincidenSelectores = ["empresa", "eps", "evento", "genero"].every(
        (clave) => !obtenerValorFiltro(clave) || reg[clave] === obtenerValorFiltro(clave)
      );

      const coincideDesde = !obtenerValorFiltro("desde") || reg.fIni >= obtenerValorFiltro("desde");
      const coincideHasta = !obtenerValorFiltro("hasta") || reg.fIni <= obtenerValorFiltro("hasta");

      return coincideTexto && coincidenSelectores && coincideDesde && coincideHasta;
    })
    .sort((a, b) => (b.fIni || "").localeCompare(a.fIni || ""));
}

FILTROS.forEach(([clave]) => {
  selector("#x_" + clave).addEventListener("input", () => renderizarLista(true));
});

selector("#fclr").onclick = () => {
  FILTROS.forEach(([clave]) => {
    selector("#x_" + clave).value = "";
  });
  renderizarLista(true);
};

function renderizarLista(mantenerFiltros = false) {
  if (!mantenerFiltros) actualizarOpcionesFiltros();

  const filtrados = filtrarRegistros();
  selector("#cnt").textContent = `${filtrados.length} de ${registros.length} registros`;

  if (!filtrados.length) {
    selector("#tbl").innerHTML = '<div class="empty">No hay registros con estos filtros.</div>';
    return;
  }

  const filasHTML = filtrados
    .map(
      (reg) => `
      <tr>
        <td>${escaparHTML(reg.nombre)}</td>
        <td>${escaparHTML(reg.cedula)}</td>
        <td>${escaparHTML(reg.empresa)}</td>
        <td>${escaparHTML(reg.eps)}</td>
        <td>${escaparHTML(reg.evento)}</td>
        <td>${escaparHTML(reg.fIni)}</td>
        <td>${escaparHTML(reg.fFin)}</td>
        <td>${escaparHTML(reg.dias)}</td>
        <td>${escaparHTML(reg.dx1)}</td>
        <td>
          ${reg.pdfPath ? `<button class="btn sec" data-p="${reg.id}" style="padding:4px 10px">Ver PDF</button>` : ""}
          <button class="btn sec" data-e="${reg.id}" style="padding:4px 10px">Editar</button>
          <button class="btn del" data-d="${reg.id}">Borrar</button>
        </td>
      </tr>`
    )
    .join("");

  selector("#tbl").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Trabajador</th>
          <th>Cédula</th>
          <th>Empresa</th>
          <th>EPS/ARL</th>
          <th>Evento</th>
          <th>Fecha inicio</th>
          <th>Fecha fin</th>
          <th>Días</th>
          <th>Dx principal</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${filasHTML}</tbody>
    </table>`;
}

selector("#tbl").addEventListener("click", (evento) => {
  const boton = evento.target.closest("button");
  if (!boton) return;

  if (boton.dataset.p) {
    const registro = registros.find((r) => r.id === boton.dataset.p);
    if (registro) verSoporte(registro.pdfPath);
  }

  if (boton.dataset.e) {
    const registro = registros.find((r) => r.id === boton.dataset.e);
    if (!registro) return;
    idEdicion = registro.id;
    llenarFormulario(registro);
    cargarSoporteDeRegistro(registro);
    selector("#save").textContent = "Guardar cambios";
    mostrarVista("reg");
    scrollTo(0, 0);
  }

  if (boton.dataset.d && confirm("¿Borrar esta incapacidad? No se puede deshacer.")) {
    supabaseCliente
      .from("incapacidades")
      .delete()
      .eq("id", boton.dataset.d)
      .then(async ({ error }) => {
        if (error) {
          mostrarToast("No se pudo borrar: " + error.message);
          return;
        }
        await cargarRegistros(); // también borra el archivo de soporte que quedó sin uso
        renderizarLista();
      });
  }
});

// ============================================================================
// RESUMEN ESTADÍSTICO
// ============================================================================

function renderizarResumen() {
  if (!registros.length) {
    selector("#rs").innerHTML = '<div class="card empty">Aún no hay incapacidades registradas.</div>';
    return;
  }

  const agrupado = {};
  registros.forEach((reg) => {
    const cedula = reg.cedula;
    if (!agrupado[cedula]) {
      agrupado[cedula] = {
        nombre: reg.nombre,
        cedula,
        empresa: reg.empresa,
        cantidad: 0,
        dias: 0
      };
    }
    agrupado[cedula].cantidad += 1;
    agrupado[cedula].dias += Number(reg.dias) || 0;
  });

  const ranking = Object.values(agrupado).sort(
    (a, b) => b.cantidad - a.cantidad || b.dias - a.dias
  );
  const primero = ranking[0];
  const maximo = primero.cantidad;
  const totalDias = registros.reduce((suma, reg) => suma + (Number(reg.dias) || 0), 0);

  const filasRanking = ranking
    .slice(0, 15)
    .map(
      (item) => `
      <tr>
        <td>${escaparHTML(item.nombre)}</td>
        <td>${escaparHTML(item.cedula)}</td>
        <td>${item.cantidad}</td>
        <td><div class="bar" style="width:${(item.cantidad / maximo) * 100}%"></div></td>
        <td>${item.dias}</td>
      </tr>`
    )
    .join("");

  selector("#rs").innerHTML = `
    <div class="card">
      <h2>Trabajador con más incapacidades</h2>
      <div class="top">
        <b>${escaparHTML(primero.nombre)}</b>
        <span>${primero.cantidad} incapacidades · ${primero.dias} días en total · cédula ${escaparHTML(primero.cedula)}</span>
      </div>
    </div>
    <div class="card">
      <h2>Ranking por trabajador</h2>
      <div class="tw">
        <table>
          <thead>
            <tr>
              <th>Trabajador</th>
              <th>Cédula</th>
              <th>Incapacidades</th>
              <th style="width:30%"></th>
              <th>Días</th>
            </tr>
          </thead>
          <tbody>${filasRanking}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h2>Totales</h2>
      <div class="top">
        <span><b>${registros.length}</b> incapacidades</span>
        <span><b>${totalDias}</b> días</span>
        <span><b>${ranking.length}</b> trabajadores</span>
      </div>
    </div>`;
}

// ============================================================================
// EXPORTAR A CSV (COMPATIBLE CON EXCEL)
// ============================================================================

selector("#exp").onclick = async () => {
  const citarCSV = (valor) => `"${String(valor ?? "").replace(/"/g, '""')}"`;

  const ordenCampos = [
    "empresa", "nombre", "cedula", "genero", "motivo", "lugar",
    "eps", "medico", "especialidad", "evento", "fAt", "fIni", "fFin",
    "dias", "dx1", "dx2", "meds", "plan", "restr", "recom", "remis"
  ];

  const filasCSV = filtrarRegistros().map((reg) => {
    const mesAtencion = obtenerNombreMes(reg.fAt || reg.fIni);
    const valores = [mesAtencion, ...ordenCampos.map((clave) => reg[clave])];
    return valores.map(citarCSV).join(";");
  });

  const contenidoCSV = "\ufeff" + [ENCABEZADOS_CSV.map(citarCSV).join(";"), ...filasCSV].join("\r\n");
  const blob = new Blob([contenidoCSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = "incapacidades.csv";
  enlace.click();
  URL.revokeObjectURL(url);
};

// ============================================================================
// LECTURA DEL DOCUMENTO (ver js/ocr.js)
// ============================================================================

selector("#pick").onclick = () => selector("#file").click();

selector("#file").onchange = async (evento) => {
  const archivo = evento.target.files[0];
  if (!archivo) return;

  // El archivo queda guardado como soporte aunque la lectura falle o el servidor esté apagado
  if (!soporte.path) subirSoporte(archivo);

  const mensajeOCR = selector("#ocrmsg");
  try {
    const datosExtraidos = await extraerDatos(archivo, (estado) => {
      mensajeOCR.textContent = estado;
    });

    idEdicion = null;
    llenarFormulario(datosExtraidos, true);
    selector("#rvhint").hidden = false;
    selector("#save").textContent = "Guardar incapacidad";

    mensajeOCR.textContent = Object.keys(datosExtraidos).length
      ? "Listo. Revisa los campos en amarillo antes de guardar."
      : "No se reconocieron datos. Llena el formulario a mano.";
  } catch (error) {
    console.error(error);
    mensajeOCR.textContent =
      "No se pudo leer el documento. Llena el formulario a mano o prueba con otro archivo.";
  }
};

// ============================================================================
// SUPABASE: CONEXIÓN Y SESIÓN DE RECURSOS HUMANOS
// ============================================================================

const configuracion = window.SUPABASE_CONFIG;

if (!configuracion || !configuracion.url || configuracion.url.includes("TU-PROYECTO")) {
  selector("#lmsg").textContent = "Falta configurar js/config.js con la URL y la clave anon de Supabase.";
} else {
  supabaseCliente = supabase.createClient(configuracion.url, configuracion.key);

  supabaseCliente.auth.onAuthStateChange((_evento, sesion) => {
    document.body.classList.toggle("locked", !sesion);
    if (sesion) {
      setTimeout(async () => {
        await cargarRegistros();
        mostrarVista("reg");
      }, 0);
    } else {
      registros = [];
    }
  });

  selector("#lf").addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const mensajeLogin = selector("#lmsg");
    mensajeLogin.textContent = "Ingresando…";

    const { error } = await supabaseCliente.auth.signInWithPassword({
      email: selector("#le").value.trim(),
      password: selector("#lp").value
    });

    mensajeLogin.textContent = error ? "Correo o contraseña incorrectos." : "";
    selector("#lp").value = "";
  });

  selector("#out").onclick = () => supabaseCliente.auth.signOut();
}
