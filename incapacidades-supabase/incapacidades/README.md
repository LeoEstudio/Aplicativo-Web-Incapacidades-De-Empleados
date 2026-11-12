# Registro de incapacidades (RH)

Aplicativo web sin backend: HTML + CSS + JavaScript.

## Estructura
- `index.html` – pantallas: Registrar, Registros y Resumen
- `css/styles.css` – estilos (claro/oscuro automático)
- `js/app.js` – formulario, filtros, ranking, exportar CSV, guardado en localStorage
- `js/ocr.js` – lectura del PDF/imagen de la EPS y llenado automático

## Cómo ejecutarlo en VS Code
1. Abre la carpeta en VS Code.
2. Instala la extensión **Live Server** y pulsa "Go Live" (o `python -m http.server 5500` y abre http://localhost:5500).
3. Necesita internet para cargar pdf.js, Tesseract.js (y su modelo de español) y la fuente.

## OCR
- PDF digital (con texto): se lee directo con pdf.js, sin OCR.
- PDF escaneado o foto: OCR con Tesseract.js en español.
- Un analizador con expresiones regulares propone los campos; se marcan en amarillo para revisión humana. Ajusta `analizar()` en `js/ocr.js` según el formato real de cada EPS.

## Conexión a Supabase
1. Crea un proyecto en supabase.com.
2. **SQL Editor** > New query: pega y ejecuta `supabase/schema.sql` (crea la tabla `incapacidades` con seguridad RLS).
3. **Authentication > Users > Add user**: crea el usuario de RH (correo y contraseña, marca "Auto Confirm User").
4. **Authentication > Sign In / Providers**: desactiva "Allow new users to sign up" para que nadie más pueda registrarse.
5. **Project Settings > API**: copia la *Project URL* y la clave *anon public* en `js/config.js`. Nunca uses la `service_role` en el navegador.
6. Abre con Live Server e ingresa con el usuario de RH.

La tabla replica las 22 columnas del Excel (más `mes_atencion`, calculada por la base de datos). Solo usuarios autenticados pueden leer o escribir.
