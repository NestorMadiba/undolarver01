# Configuración y Despliegue de la Aplicación

¡Felicidades! Has llegado a la fase donde tu aplicación se conecta a un "cerebro" real y se prepara para salir al mundo. Este archivo te guiará para poner en marcha el servidor backend tanto en tu computadora como en un servidor online de producción.

## PARTE 1: Puesta en Marcha en tu Computadora (Desarrollo Local)

Esto es para probar todo en tu propia máquina antes de subirlo a internet.

### Requisitos Previos

Necesitas tener **Node.js** instalado. Es el entorno que ejecuta el código del servidor.

1.  **Descarga Node.js**: Ve a [https://nodejs.org/](https://nodejs.org/) y descarga la versión **LTS**.
2.  **Instálalo**: Sigue los pasos del instalador. Es como instalar cualquier otro programa.
3.  **Verifica la instalación**: Abre una terminal o línea de comandos (en Windows busca "cmd" o "PowerShell", en Mac busca "Terminal") y escribe: `node -v`. Si ves un número de versión (ej: `v18.18.0`), ¡está listo!

### Pasos para Ejecutar Localmente

1.  **Crea tu archivo de Claves Secretas**:
    *   En la misma carpeta donde está `server.js`, crea un nuevo archivo llamado `.env`.
    *   Abre el archivo `.env` y añade tu "Access Token" de Mercado Pago. Lo obtienes de tu cuenta de Mercado Pago > Tus Negocios > Configuración > Credenciales de producción.
    ```
    MERCADOPAGO_ACCESS_TOKEN=TU_ACCESS_TOKEN_DE_PRODUCCION
    ```
    *   > **Importante**: El archivo `.env` es para tus secretos. Nunca lo compartas ni lo subas a GitHub.

2.  **Instala las Dependencias**:
    *   En tu terminal, dentro de la carpeta del proyecto, ejecuta este único comando. Se descargarán las herramientas que el servidor necesita.
    ```bash
    npm install
    ```

3.  **Inicia el Servidor**:
    *   ¡Ya está todo listo! Para encender tu servidor backend, ejecuta:
    ```bash
    npm start
    ```
    *   Verás un mensaje: `Servidor escuchando en el puerto 4000`. No cierres esta terminal.

Ahora, si abres tu archivo `index.html` en el navegador, debería poder conectarse al servidor y funcionar completamente.

---

## PARTE 2: Puesta en Producción Online (¡Hacerla Pública!)

Para que tu aplicación esté disponible en internet, el Frontend y el Backend deben vivir en lugares diferentes.

*   **Frontend (`index.html`, `index.css`)**: Lo subiremos a **Netlify**.
*   **Backend (`server.js`)**: Lo subiremos a **Render**. (Ambos tienen planes gratuitos excelentes).

### Paso 1: Desplegar el Backend en Render

1.  **Regístrate en Render**: Ve a [https://render.com/](https://render.com/) y crea una cuenta (puedes usar tu cuenta de GitHub, GitLab, etc.).
2.  **Sube tu código a GitHub**: Si aún no lo has hecho, sube tu proyecto (incluyendo `server.js`, `package.json`, etc., **PERO NO la carpeta `node_modules` ni el archivo `.env`**) a un repositorio de GitHub.
3.  **Crea un Nuevo Servicio en Render**:
    *   En tu Dashboard de Render, haz clic en **New +** y luego en **Web Service**.
    *   Conecta tu cuenta de GitHub y selecciona el repositorio de tu proyecto.
    *   Render detectará que es un proyecto de Node.js. Dale un nombre único (ej: `mi-backend-1dolar`).
    *   En la sección `Build Command`, asegúrate que diga `npm install`.
    *   En la sección `Start Command`, asegúrate que diga `npm start`.
    *   Haz clic en **Advanced**. Aquí es donde pondrás tus claves secretas de forma segura.
    *   Haz clic en **Add Environment Variable**.
        *   **Key**: `MERCADOPAGO_ACCESS_TOKEN`, **Value**: `TU_ACCESS_TOKEN_DE_PRODUCCION` (el mismo que usaste localmente).
        *   **Key**: `FRONTEND_URL`, **Value**: `LA_URL_DE_TU_APP_EN_NETLIFY` (la obtendrás en el siguiente paso, déjala en blanco por ahora y la editas después).
    *   Haz clic en **Create Web Service**. Render comenzará a construir y desplegar tu backend. Cuando termine, te dará una URL pública, algo como `https://mi-backend-1dolar.onrender.com`. ¡Cópiala!

### Paso 2: Desplegar el Frontend en Netlify y Conectarlo

1.  **Prepara tu Frontend**:
    *   Abre tu archivo `index.html`.
    *   Busca la línea: `const API_URL = 'http://localhost:4000/api';`
    *   **Reemplaza** `'http://localhost:4000/api'` por la URL que te dio Render en el paso anterior, asegurándote de añadir `/api` al final. Debería quedar así:
        ```javascript
        const API_URL = 'https://mi-backend-1dolar.onrender.com/api';
        ```
    *   Guarda el archivo.

2.  **Despliega en Netlify**:
    *   Regístrate en [https://www.netlify.com/](https://www.netlify.com/).
    *   En tu dashboard, simplemente **arrastra y suelta la carpeta** que contiene tu `index.html` y `index.css`.
    *   Netlify subirá tus archivos y en segundos te dará una URL pública (ej: `https://mi-app-genial.netlify.app`). ¡Cópiala!

### Paso 3: Conexión Final

1.  **Vuelve a Render**:
    *   Ve a la configuración de tu Web Service.
    *   Busca la sección de **Environment Variables**.
    *   Edita la variable `FRONTEND_URL` que dejaste en blanco antes y pega la URL que te dio Netlify.
    *   Guarda los cambios. Render se reiniciará automáticamente.

**¡LISTO!** Ahora tu URL de Netlify es la versión pública y funcional de tu aplicación. El frontend en Netlify se comunica con el backend en Render, y los pagos de Mercado Pago redirigirán correctamente al usuario.
