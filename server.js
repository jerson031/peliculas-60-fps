const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const ftp = require("basic-ftp");
const cheerio = require("cheerio");

// ==========================================
// CONFIGURACIÓN DE CREDENCIALES
// ==========================================
const FTP_USER = "admin"; 
const FTP_PASS = "31cd618bb2"; 
const FTP_HOST = "192.168.1.220"; // IP local limpia, sin puertos ni letras adicionales
const FTP_PORT = 21; 

// Tu disco duro grande está mapeado como 'volume2(H:)' y dentro tienes la carpeta 'Peliculas'
const FTP_FOLDER = "/";
  // Carpeta en tu USB donde están los videos

let peliculasCatalog = {};

// ==========================================
// BUSCADOR AUTOMÁTICO DE IMDB (SIN API KEY)
// ==========================================
function limpiarNombreArchivo(filename) {
  let clean = filename.substring(0, filename.lastIndexOf('.')) || filename;
  clean = clean.replace(/[\.\-_]/g, ' ');
  const yearMatch = clean.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : null;
  
  clean = clean.replace(/\b(1080p|2160p|4k|60fps|bluray|x264|h264|x265|hevc|mkv|mp4|dual|latino|sub)\b/gi, '');
  const title = clean.trim();
  
  return { title, year };
}

async function buscarIdIMDb(titulo, anio) {
  try {
    // Buscamos directamente en el motor de DuckDuckGo simulando un navegador tradicional
    const query = encodeURIComponent(`${titulo} ${anio || ''} imdb`);
    const url = `https://duckduckgo.com{query}`;
    
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const html = await response.text();
    const $ = cheerio.load(html);
    
    let imdbId = null;

    // Escaneamos los enlaces de los resultados de búsqueda buscando el patrón de IMDb (ttXXXXXXX)
    $("a.result__url").each((i, el) => {
      const href = $(el).attr("href");
      const match = href ? href.match(/imdb\.com\/title\/(tt\d+)/) : null;
      if (match && !imdbId) {
        imdbId = match[1];
      }
    });

    return imdbId;
  } catch (error) {
    return null;
  }
}

async function escanearYAutoMapearFTP() {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  
  try {
    console.log("Conectando al FTP de tu router...");
    await client.access({
      host: FTP_HOST,
      user: FTP_USER,
      password: FTP_PASS,
      port: FTP_PORT,
      secure: false
    });

    const files = await client.list(FTP_FOLDER);
    const nuevoCatalogo = {};

    for (const file of files) {
      if (file.isDirectory || !/\.(mp4|mkv|avi|mov)$/i.test(file.name)) continue;

      const { title, year } = limpiarNombreArchivo(file.name);
      if (!title) continue;

      // Pausa de medio segundo entre archivos para evitar bloqueos
      await new Promise(resolve => setTimeout(resolve, 500));

      const imdbId = await buscarIdIMDb(title, year);

      if (imdbId) {
        nuevoCatalogo[imdbId] = {
          title: `${title} (${year || 'S/A'}) [60fps]`,
          file: file.name
        };
        console.log(`✅ Vinculado: "${file.name}" ➡️ IMDb ID: ${imdbId}`);
      } else {
        console.log(`⚠️ No se pudo encontrar ID en IMDb para: "${file.name}"`);
      }
    }

    peliculasCatalog = nuevoCatalogo;
    console.log("✨ Escaneo y auto-mapeo completado.");

  } catch (err) {
    console.error("❌ Error en la conexión FTP:", err.message);
  } {
    client.close();
  }
}

// ==========================================
// CONFIGURACIÓN DEL ADDON DE STREMIO
// ==========================================
const manifest = {
  id: "com.autor.routerftpautomap",
  version: "1.2.0",
  name: "Mi Servidor FTP Libre",
  description: "Streaming automático desde mi router sin APIs externas",
  resources: ["stream"],
  types: ["movie"],
  idPrefixes: ["tt"],
  catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler((args) => {
  const imdbId = args.id;

  if (peliculasCatalog[imdbId]) {
    const peli = peliculasCatalog[imdbId];
    const encodedFile = encodeURIComponent(peli.file);
    const cleanFolder = FTP_FOLDER.endsWith('/') ? FTP_FOLDER : `${FTP_FOLDER}/`;
    const ftpUrl = `ftp://${FTP_USER}:${FTP_PASS}@${FTP_HOST}:${FTP_PORT}${cleanFolder}${encodedFile}`;

    return Promise.resolve({
      streams: [
        {
          name: "Router FTP",
          title: `${peli.title}\n⚡ Stream Directo`,
          url: ftpUrl
        }
      ]
    });
  }

  return Promise.resolve({ streams: [] });
});

// ==========================================
// INICIALIZACIÓN
// ==========================================
const port = process.env.PORT || 7000;

escanearYAutoMapearFTP().then(() => {
  serveHTTP(builder.getInterface(), { port }).then(({ url }) => {
    console.log(`Addon levantado en el puerto ${port}`);
    console.log(`Enlace de instalación para Stremio: ${url}/manifest.json`);
  });
});
