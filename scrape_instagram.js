const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

const HANDLE = 'mafejimenezzz_';

async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(filepath); });
    }).on('error', (err) => { fs.unlink(filepath, () => {}); reject(err); });
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'es-ES',
  });
  const page = await context.newPage();

  console.log(`Accediendo a instagram.com/${HANDLE} ...`);
  await page.goto(`https://www.instagram.com/${HANDLE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Cerrar diálogos de login si aparecen
  try {
    const closeBtn = page.locator('[aria-label="Close"]');
    if (await closeBtn.isVisible({ timeout: 2000 })) await closeBtn.click();
  } catch {}
  try {
    const notNow = page.locator('text=Not Now, text=Ahora no').first();
    if (await notNow.isVisible({ timeout: 2000 })) await notNow.click();
  } catch {}

  await page.waitForTimeout(2000);

  // Extraer datos del perfil via JSON embebido
  const data = await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script[type="application/json"]')];
    let profileData = null;
    for (const s of scripts) {
      try {
        const json = JSON.parse(s.textContent);
        const str = JSON.stringify(json);
        if (str.includes('edge_followed_by') || str.includes('biography')) {
          profileData = json;
          break;
        }
      } catch {}
    }

    // Fallback: extraer del HTML
    const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
    const title = document.querySelector('title')?.textContent || '';
    const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';

    // Intentar extraer stats del meta description
    // Formato típico: "X Followers, Y Following, Z Posts"
    const followersMatch = metaDesc.match(/(\d[\d,.]*)\s*(Followers|Seguidores)/i);
    const followingMatch = metaDesc.match(/(\d[\d,.]*)\s*(Following|Seguidos)/i);
    const postsMatch = metaDesc.match(/(\d[\d,.]*)\s*(Posts|Publicaciones)/i);

    // Bio del meta description
    const bioMatch = metaDesc.match(/- (.+)$/s);

    return {
      rawTitle: ogTitle || title,
      metaDesc,
      ogImage,
      followers: followersMatch ? followersMatch[1] : null,
      following: followingMatch ? followingMatch[1] : null,
      posts: postsMatch ? postsMatch[1] : null,
      bio: bioMatch ? bioMatch[1].trim() : '',
      rawData: profileData ? JSON.stringify(profileData).substring(0, 500) : 'no json found'
    };
  });

  console.log('Datos extraídos:', JSON.stringify(data, null, 2));

  // Extraer foto de perfil
  const profilePicUrl = data.ogImage;

  // Extraer posts/fotos de la galería
  const posts = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('article img, main img, ._aagv img')];
    return imgs.slice(0, 9).map(img => ({
      src: img.src,
      alt: img.alt || ''
    })).filter(i => i.src && i.src.startsWith('http'));
  });

  console.log(`Fotos encontradas: ${posts.length}`);

  // Guardar assets
  const assetsDir = path.join(__dirname, 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);

  // Descargar foto de perfil
  let profilePicLocal = null;
  if (profilePicUrl) {
    try {
      profilePicLocal = path.join(assetsDir, 'profile.jpg');
      await downloadImage(profilePicUrl, profilePicLocal);
      console.log('Foto de perfil descargada');
    } catch (e) {
      console.log('No se pudo descargar foto de perfil:', e.message);
    }
  }

  // Descargar fotos de posts
  const localPosts = [];
  for (let i = 0; i < Math.min(posts.length, 9); i++) {
    try {
      const localPath = path.join(assetsDir, `post_${i + 1}.jpg`);
      await downloadImage(posts[i].src, localPath);
      localPosts.push({ local: `assets/post_${i + 1}.jpg`, alt: posts[i].alt });
      console.log(`Post ${i + 1} descargado`);
    } catch (e) {
      console.log(`Post ${i + 1} no descargado:`, e.message);
    }
  }

  // Extraer nombre del título
  let name = '';
  if (data.rawTitle) {
    const m = data.rawTitle.match(/^(.+?)\s*[\(@]/);
    name = m ? m[1].trim() : data.rawTitle.split('•')[0].trim();
  }

  const result = {
    handle: HANDLE,
    name,
    bio: data.bio,
    followers: data.followers,
    following: data.following,
    posts: data.posts,
    profilePicUrl,
    profilePicLocal: profilePicLocal ? 'assets/profile.jpg' : null,
    localPosts,
    metaDesc: data.metaDesc,
  };

  fs.writeFileSync(path.join(__dirname, 'instagram_data.json'), JSON.stringify(result, null, 2));
  console.log('\n✅ Datos guardados en instagram_data.json');

  await browser.close();
})();
