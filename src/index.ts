import express from 'express';
import type { Request, Response } from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3000;

// Log the static path being used
const staticPath = join(__dirname, '../public');
console.log('Serving static files from:', staticPath);

app.use(express.static(staticPath));

app.get('/', (req: Request, res: Response) => {
    const htmlPath = join(__dirname, '../public/index.html');
    console.log('Serving index.html from:', htmlPath);
    res.sendFile(htmlPath);
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 