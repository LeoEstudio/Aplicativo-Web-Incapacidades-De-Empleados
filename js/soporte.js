// ============================================================================
// SOPORTE DE LA EPS: zona de carga independiente para guardar el PDF de la
// incapacidad junto al registro. El archivo va del navegador a Supabase Storage,
// sin pasar por el servidor de Gemini. Cargar DESPUÉS de app.js.
// No requiere editar app.js: engancha sus funciones existentes.
// ============================================================================
(() => {
  const BUCKET = "incapacidades-pdf", MAX_MB = 10;
  const TIPOS = /^(application\/pdf|image\/(jpeg|png|webp))$/;
  const $s = (css) => document.querySelector(css);
  const nuevoEstado = () => ({ path: null, nombre: null, tam: 0, cambio: false, pendiente: null, subiendo: false });
  let est = nuevoEstado();   // path: archivo del registro; pendiente: subido pero aún sin guardar
  const almacen = () => supabaseCliente.storage.from(BUCKET);
  const formatoTam = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB");

  // ---------- Interfaz ----------
  document.head.insertAdjacentHTML("beforeend", `<style>
    .sop{border:2px dashed var(--ac);background:var(--acs);border-radius:8px;padding:18px;text-align:center;cursor:pointer}
    .sop.arrastre{background:var(--bg);border-style:solid}.sop small{color:var(--mut)}
    .sopAcc{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}</style>`);
  $s("#g4").insertAdjacentHTML("afterend", `
    <h2 style="margin-top:18px">Soporte de la EPS (PDF de la incapacidad)</h2>
    <div class="sop" id="sopZona" tabindex="0" role="button" aria-label="Cargar el PDF de la incapacidad">
      <input type="file" id="sopInput" accept="application/pdf,image/jpeg,image/png,image/webp" hidden>
      <div id="sopTexto"></div></div>
    <div class="sopAcc"><button class="btn sec" type="button" id="sopVer" hidden>Ver archivo</button>
      <button class="btn del" type="button" id="sopQuitar" hidden>Quitar</button></div>`);

  function pintar() {
    const hay = Boolean(est.path);
    $s("#sopTexto").innerHTML = est.subiendo ? "Subiendo archivo…"
      : hay ? `<b>${escaparHTML(est.nombre || "Archivo guardado")}</b>${est.tam ? " · " + formatoTam(est.tam) : ""}<br><small>Haz clic o arrastra otro archivo para reemplazarlo</small>`
      : `Arrastra aquí el PDF de la incapacidad<br><small>o haz clic para elegirlo (PDF o imagen, máx. ${MAX_MB} MB)</small>`;
    $s("#sopVer").hidden = !hay;
    $s("#sopQuitar").hidden = !hay;
  }

  // ---------- Subida y descarte ----------
  async function descartarPendiente() {
    const p = est.pendiente; est.pendiente = null;
    if (p) await almacen().remove([p]);
  }
  async function elegir(archivo) {
    if (!archivo) return;
    if (!TIPOS.test(archivo.type)) return mostrarToast("Solo se admiten PDF o imágenes (JPG, PNG, WEBP).");
    if (archivo.size > MAX_MB * 1048576) return mostrarToast(`El archivo supera ${MAX_MB} MB.`);
    est.subiendo = true; pintar();
    const limpio = archivo.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.\-]+/g, "_");
    const path = `${crypto.randomUUID()}/${limpio}`;
    const { error } = await almacen().upload(path, archivo, { contentType: archivo.type });
    est.subiendo = false;
    if (error) { pintar(); return mostrarToast("No se pudo subir el archivo: " + error.message); }
    await descartarPendiente();
    Object.assign(est, { path, nombre: archivo.name, tam: archivo.size, cambio: true, pendiente: path });
    pintar();
  }
  async function ver(path) {
    if (!path) return;
    const ventana = window.open("", "_blank");   // se abre antes del await para evitar el bloqueo de pop-ups
    const { data, error } = await almacen().createSignedUrl(path, 300);
    if (error) { if (ventana) ventana.close(); return mostrarToast("No se pudo abrir el archivo: " + error.message); }
    ventana ? (ventana.location.href = data.signedUrl) : window.open(data.signedUrl);
  }

  // ---------- Eventos de la zona ----------
  const zona = $s("#sopZona"), input = $s("#sopInput");
  zona.onclick = () => input.click();
  zona.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } };
  input.onchange = () => { elegir(input.files[0]); input.value = ""; };
  ["dragenter", "dragover"].forEach((n) => zona.addEventListener(n, (e) => { e.preventDefault(); zona.classList.add("arrastre"); }));
  ["dragleave", "drop"].forEach((n) => zona.addEventListener(n, (e) => { e.preventDefault(); zona.classList.remove("arrastre"); }));
  zona.addEventListener("drop", (e) => elegir(e.dataTransfer.files[0]));
  $s("#sopVer").onclick = () => ver(est.path);
  $s("#sopQuitar").onclick = async () => {
    await descartarPendiente();
    Object.assign(est, { path: null, nombre: null, tam: 0, cambio: true });
    pintar();
  };
  // Si RH sube un PDF a Gemini y todavía no hay soporte, se guarda también como soporte
  $s("#file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f && !est.path) elegir(f); });
  // "Limpiar" cancela: borra lo subido que no se guardó
  $s("#clr").onclick = async () => { await descartarPendiente(); reiniciarFormulario(); };

  // ---------- Enganches a las funciones de app.js ----------
  const _desde = convertirDesdeDB;
  convertirDesdeDB = (fila) => ({ ..._desde(fila), pdf_path: fila.pdf_path || null, pdf_nombre: fila.pdf_nombre || null });

  const _para = convertirParaDB;
  convertirParaDB = (datos) => {
    const fila = _para(datos);
    if (est.cambio) { fila.pdf_path = est.path; fila.pdf_nombre = est.nombre; }
    return fila;
  };

  const _llenar = llenarFormulario;
  llenarFormulario = function (datos, resaltar) {
    _llenar(datos, resaltar);
    if (datos && datos.id) {   // al editar un registro existente
      descartarPendiente();
      est = { ...nuevoEstado(), path: datos.pdf_path, nombre: datos.pdf_nombre };
      pintar();
    }
  };

  const _reiniciar = reiniciarFormulario;   // también se llama tras guardar con éxito
  reiniciarFormulario = function () { _reiniciar(); est = nuevoEstado(); pintar(); };

  // Tras recargar, borra de Storage los archivos que ningún registro usa ya
  // (registro borrado, soporte reemplazado o quitado). Verifica antes de borrar.
  const _cargar = cargarRegistros;
  cargarRegistros = async function () {
    const antes = new Set(registros.map((r) => r.pdf_path).filter(Boolean));
    await _cargar();
    const ahora = new Set(registros.map((r) => r.pdf_path).filter(Boolean));
    for (const p of [...antes].filter((x) => !ahora.has(x))) {
      const { count, error } = await supabaseCliente.from("incapacidades")
        .select("id", { count: "exact", head: true }).eq("pdf_path", p);
      if (!error && count === 0) await almacen().remove([p]);
    }
  };

  // Botón "Ver PDF" en la tabla de registros
  const _lista = renderizarLista;
  renderizarLista = function (mantener) {
    _lista(mantener);
    document.querySelectorAll("#tbl button[data-e]").forEach((b) => {
      const r = registros.find((x) => x.id === b.dataset.e);
      if (r && r.pdf_path) b.insertAdjacentHTML("beforebegin", `<button class="btn sec" data-p="${r.id}" style="padding:4px 10px">Ver PDF</button> `);
    });
  };
  $s("#tbl").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-p]");
    const r = b && registros.find((x) => x.id === b.dataset.p);
    if (r) ver(r.pdf_path);
  });

  pintar();
})();
