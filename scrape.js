const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const url = 'https://www.prog.co.il/threads/%D7%90%D7%A1%D7%A3-%D7%A7%D7%91%D7%A6%D7%99%D7%9D-%D7%9E%D7%A9%D7%97%D7%A7%D7%99-%D7%A7%D7%95%D7%A4%D7%A1%D7%94.552913/page-118';
// הנתיב לתיקיית האחסון הקבוע ב-Railway
const downloadDir = '/data';
// הנתיב לקובץ הלוג בתוך תיקיית האחסון הקבוע
const downloadedFilesPath = path.join(downloadDir, 'downloaded_files.json');

// פונקציה לוודא שהתיקייה קיימת
function ensureDirectoryExistence(filePath) {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
        return true;
    }
    ensureDirectoryExistence(dirname);
    fs.mkdirSync(dirname);
}

// פונקציה לקריאת קבצים שכבר הורדו
function loadDownloadedFiles() {
    try {
        if (fs.existsSync(downloadedFilesPath)) {
            const data = fs.readFileSync(downloadedFilesPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error reading downloaded files log:', error);
    }
    return {};
}

// פונקציה לשמירת קבצים שהורדו
function saveDownloadedFile(fileName) {
    const downloadedFiles = loadDownloadedFiles();
    downloadedFiles[fileName] = true;
    try {
        fs.writeFileSync(downloadedFilesPath, JSON.stringify(downloadedFiles, null, 2));
    } catch (error) {
        console.error('Error saving downloaded file log:', error);
    }
}

async function scrapeAndDownload() {
    try {
        console.log('מתחיל סריקה של עמוד הפורום...');
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        const downloadedFiles = loadDownloadedFiles();

        const downloadLinks = [];
        $('a.link.link--internal').each((i, link) => {
            const href = $(link).attr('href');
            if (href && href.startsWith('/attachments/')) {
                const fullUrl = `https://www.prog.co.il${href}`;
                downloadLinks.push(fullUrl);
            }
        });

        console.log(`נמצאו ${downloadLinks.length} קישורים לקבצים.`);

        for (const link of downloadLinks) {
            const fileName = decodeURIComponent(link.split('/').pop().split('?')[0]);
            
            if (downloadedFiles[fileName]) {
                console.log(`מדלג על הקובץ "${fileName}" (כבר הורד בעבר).`);
                continue;
            }

            try {
                console.log(`מוריד את הקובץ "${fileName}"...`);
                const response = await axios({
                    method: 'GET',
                    url: link,
                    responseType: 'stream'
                });

                const filePath = path.join(downloadDir, fileName);
                const writer = fs.createWriteStream(filePath);

                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', () => {
                        console.log(`הקובץ "${fileName}" הורד בהצלחה.`);
                        saveDownloadedFile(fileName);
                        resolve();
                    });
                    writer.on('error', (err) => {
                        console.error(`שגיאה בכתיבת הקובץ "${fileName}":`, err);
                        reject(err);
                    });
                });

            } catch (error) {
                console.error(`שגיאה בהורדת הקובץ "${fileName}":`, error.message);
            }
        }

        // --- הקטע החדש מתחיל כאן ---
        console.log('----- סריקה והורדה הושלמו -----');

        try {
            const allFiles = fs.readdirSync(downloadDir);
            console.log('רשימת קבצים מלאה ב-Volume:');
            allFiles.forEach(file => {
                console.log(`- ${file}`);
            });
        } catch (e) {
            console.error('לא ניתן היה לקרוא את רשימת הקבצים מה-Volume:', e);
        }

        console.log(`הסריקה הבאה מתוכננת להתבצע לפי לוח הזמנים.`);
        // --- הקטע החדש נגמר כאן ---

    } catch (error) {
        console.error('אירעה שגיאה כללית בתהליך הסריקה:', error);
    }
}

// ודא שתיקיית ההורדות קיימת לפני ההרצה
ensureDirectoryExistence(downloadedFilesPath);
scrapeAndDownload();
