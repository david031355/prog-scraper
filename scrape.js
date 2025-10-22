// --- ייבוא ספריות ---
const puppeteer = require('puppeteer');
const fs = require('fs/promises');

// --- הגדרות ראשוניות ---
const BASE_URL = 'https://www.prog.co.il/threads/%D7%94%D7%A1%D7%99%D7%A0%D7%92%D7%9C%D7%99%D7%9D-%D7%95%D7%94%D7%A7%D7%9C%D7%99%D7%A4%D7%99%D7%9D-%D7%94%D7%97%D7%93%D7%A9%D7%99%D7%9D.387726/page-';

const START_PAGE = 1294; // שנה את המספר הזה לעמוד הראשון שממנו תרצה להתחיל לסרוק


const PROCESSED_LOG_FILE = 'processed_songs.log';
const LAST_PAGE_LOG_FILE = 'last_page.log';

// --- פונקציות עזר (אין צורך לגעת בהן) ---

function sanitizeFileName(filename) {
    return filename.replace(/[<>:"\/\\|?*]/g, '').replace(/[\s:]/g, '_').replace(/_{2,}/g, '_');
}

async function readLogFile(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return new Set(data.split('\n').filter(line => line.trim() !== ''));
    } catch (error) {
        if (error.code === 'ENOENT') return new Set();
        throw error;
    }
}

async function appendToLogFile(filePath, line) {
    await fs.appendFile(filePath, line + '\n', 'utf-8');
}

async function getStartPage() {
    try {
        const data = await fs.readFile(LAST_PAGE_LOG_FILE, 'utf-8');
        const pageNum = parseInt(data.trim(), 10);
        return isNaN(pageNum) ? START_PAGE : pageNum;
    } catch (error) {
        return START_PAGE;
    }
}

async function setLastPage(pageNum) {
    await fs.writeFile(LAST_PAGE_LOG_FILE, String(pageNum), 'utf-8');
}


// --- הפונקציה הראשית שמבצעת את כל העבודה ---

async function scrapeProg() {
    console.log('--- מתחיל ריצת סקריפט חדשה ---');
    let browser = null;

    try {
        const processedSongs = await readLogFile(PROCESSED_LOG_FILE);
        let currentPage = await getStartPage();
        console.log(`מתחיל סריקה מעמוד: ${currentPage}. נמצאו ${processedSongs.size} שירים שכבר עובדו.`);
        
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');

        let isFirstPage = true;

        while (true) {
            // אם זו לא הריצה הראשונה של הלולאה, קדם את העמוד
            if (!isFirstPage) {
                currentPage++;
            }
            isFirstPage = false;

            const currentUrl = BASE_URL + currentPage;
            console.log(`\n>>> סורק עמוד ${currentPage}: ${currentUrl}`);
            
            await page.goto(currentUrl, { waitUntil: 'networkidle2' });
            
            try {
                await page.waitForSelector('article.message--post', { timeout: 20000 });
            } catch (e) {
                console.log(`עמוד ${currentPage} ריק או לא קיים. עוצר את הסריקה.`);
                await setLastPage(currentPage - 1); // שמור את העמוד התקין האחרון
                break;
            }
            
            console.log('פוסטים זוהו. מחלץ מידע...');
            const songsData = await page.$$eval('article.message--post', (posts) => {
                const results = [];
                posts.forEach(post => {
                    const titleElement = post.querySelector('div.bbWrapper b span[style*="font-size"]');
                    const songName = titleElement ? titleElement.innerText.trim() : null;
                    if (songName) {
                        const contentClone = post.querySelector('div.bbWrapper').cloneNode(true);
                        contentClone.querySelectorAll('div.bbCodeBlock, div.bbMediaWrapper').forEach(el => el.remove());
                        const credits = contentClone.innerText.replace(songName, '').trim();
                        const audioSource = post.querySelector('audio source');
                        const mp3Link = audioSource ? audioSource.src : null;
                        if (mp3Link) results.push({ songName, credits, mp3Link });
                    }
                });
                return results;
            });
            
            const newSongs = songsData.filter(song => !processedSongs.has(song.songName));

            if (newSongs.length > 0) {
                console.log(`נמצאו ${newSongs.length} שירים חדשים מתוך ${songsData.length} בעמוד.`);
                
                for (const song of newSongs) {
                    console.log(`--- מעבד את: ${song.songName} ---`);
                    const baseFileName = sanitizeFileName(song.songName);
                    
                    const ttsContent = `${song.songName}. ${song.credits.replace(/\s+/g, ' ').trim()}`;
                    await fs.writeFile(`${baseFileName}.tts`, ttsContent);
                    console.log(`קובץ TTS נשמר: ${baseFileName}.tts`);
                    
                    const response = await fetch(song.mp3Link);
                    if (response.ok) {
                        const audioBuffer = await response.arrayBuffer();
                        await fs.writeFile(`${baseFileName}.mp3`, Buffer.from(audioBuffer));
                        console.log(`קובץ MP3 נשמר: ${baseFileName}.mp3`);
                        
                        await appendToLogFile(PROCESSED_LOG_FILE, song.songName);
                        processedSongs.add(song.songName); // הוסף לזיכרון כדי למנוע כפילות באותה ריצה
                    } else {
                        console.error(`שגיאה בהורדת הקובץ: ${response.statusText}`);
                    }
                }
            } else {
                 console.log(`לא נמצאו שירים חדשים בעמוד ${currentPage}.`);
            }
            
            await setLastPage(currentPage);
            console.log(`עמוד ${currentPage} עובד בהצלחה. ההתקדמות נשמרה.`);
        }
        
    } catch (error) {
        console.error('אירעה שגיאה קריטית בתהליך הסריקה:', error);
    } finally {
        if (browser) await browser.close();
        console.log('\n--- ריצת הסקריפט הסתיימה. ---');
    }
}

scrapeProg();