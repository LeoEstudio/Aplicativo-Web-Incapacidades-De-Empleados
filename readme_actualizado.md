# Registro de Incapacidades (RRHH)

Aplicativo web Serverless (100% Frontend: HTML + CSS + JavaScript). No requiere servidor local, ya que utiliza Supabase (Backend as a Service) para la base de datos, autenticación, almacenamiento y funciones en la nube.

## Estructura
- `index.html` – pantallas principales: Registrar, Registros y Resumen.
- `css/styles.css` – estilos con modo claro/oscuro automático.
- `js/config.js` – credenciales públicas de conexión a Supabase.
- `js/app.js` – lógica del formulario, filtros, ranking, exportación a CSV y guardado en la base de datos de Supabase.
- `js/ocr.js` – lectura automatizada del documento mediante IA (Gemini) vía Edge Functions.
- `js/soporte.js` – carga directa del archivo (PDF/Imagen) a Supabase Storage.

## Cómo ejecutarlo y publicarlo
**En local (VS Code):**
1. Abre la carpeta del proyecto en VS Code.
2. Instala la extensión **Live Server** y pulsa "Go Live" (o ejecuta `python -m http.server 5500` y abre http://localhost:5500).
3. Requiere conexión a internet para cargar las librerías CDN (pdf.js, Supabase) y conectarse a la base de datos.

**En Producción (GitHub Pages):**
Al ser un proyecto 100% estático, puedes ir a la configuración de tu repositorio en GitHub > Pages y desplegarlo directamente desde la rama `main`. Recuerda agregar la URL pública a la lista de dominios permitidos (Site URL) en la configuración de Autenticación de Supabase.

## Lectura Inteligente de Documentos
- Al cargar un PDF o imagen, el archivo se envía a una **Edge Function** en Supabase (`leer-incapacidad`).
- Esta función utiliza **Gemini** para interpretar el documento, extraer los datos médicos (CIE-10, fechas, médico) y proponerlos en el formulario.
- Los campos extraídos automáticamente se resaltan en amarillo para revisión humana antes de guardar.

## Configuración en Supabase
Para que el proyecto funcione al 100%, debes configurar los siguientes módulos en tu proyecto de [supabase.com](https://supabase.com):

1. **Base de Datos (SQL Editor):** Ejecuta el script de creación de la tabla `incapacidades` (replica las 22 columnas del formato de RRHH) y activa las políticas de seguridad RLS.
2. **Almacenamiento (Storage):** Crea un bucket llamado `incapacidades-pdf` para guardar los soportes físicos.
3. **Autenticación (Auth):**
   - **Users:** Crea manualmente el usuario de Recursos Humanos (correo y contraseña, marca "Auto Confirm User").
   - **Providers:** Desactiva "Allow new users to sign up" para bloquear el registro de personas ajenas a la empresa.
4. **Funciones (Edge Functions):** Despliega la función `leer-incapacidad` que se conecta con la API de Gemini.
5. **Conexión (Project Settings > API):** Copia la *Project URL* y la clave *anon public* y pégalas en el archivo `js/config.js`. *(Nota: Nunca uses la clave `service_role` en el frontend).*

**Seguridad:** Solo los usuarios autenticados pueden leer, escribir o subir documentos. Toda la seguridad recae en las políticas RLS de Supabase.