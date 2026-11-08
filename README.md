# Photobooth backend

Ontvangt foto's van TouchDesigner, bewaart ze in `uploads/` en zet de gegevens in MongoDB.

## Starten
1. Installeer Node.js (nodejs.org, LTS-versie).
2. Open een terminal in deze map en voer uit:
   ```
   npm install
   ```
3. Kopieer `.env.example` naar `.env` en vul `MONGODB_URI` in (jouw MongoDB-adres).
4. Start de server:
   ```
   npm start
   ```
   Je ziet `Verbonden met MongoDB` en `Backend draait op http://localhost:3000`.

## Endpoints
| Methode | URL | Wat |
|---|---|---|
| POST | `/api/photos` | Foto uploaden (veld `photo`, plus `nummer` en `sessie`) |
| GET | `/api/photos` | Laatste 200 foto's |
| GET | `/api/sessions/:sessie` | De foto's van één fotostrip |
| DELETE | `/api/photos/:id` | Foto verwijderen |
| GET | `/uploads/<bestand>` | De afbeelding zelf |
| GET | `/api/health` | Test of de server draait |

## TouchDesigner
In de DAT `booth`:
```python
BACKEND_URL = 'http://localhost:3000/api/photos'
FIELD = 'photo'
```
Staat de server op een andere computer, gebruik dan het IP-adres van die computer in plaats van `localhost`.
