// Lectura del documento con Gemini a través de la Edge Function "leer-incapacidad" de Supabase.
// No necesita servidor local: la función corre en Supabase y solo atiende a RH con sesión iniciada.
const MAX_LECTURA_MB = 8;

function archivoABase64(archivo) {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result).split(",")[1]);
    lector.onerror = () => rechazar(new Error("No se pudo leer el archivo."));
    lector.readAsDataURL(archivo);
  });
}

async function extraerDatos(archivo, aviso) {
  if (archivo.size > MAX_LECTURA_MB * 1048576) {
    throw new Error(`El archivo supera ${MAX_LECTURA_MB} MB para la lectura automática.`);
  }
  aviso("Enviando el documento a Gemini…");
  const archivoBase64 = await archivoABase64(archivo);

  aviso("Gemini está leyendo la incapacidad…");
  // invoke() envía solo el token de la sesión de RH
  const { data, error } = await supabaseCliente.functions.invoke("leer-incapacidad", {
    body: { archivoBase64, mimeType: archivo.type }
  });
  if (error) throw error;
  return data?.datos ?? {};
}
