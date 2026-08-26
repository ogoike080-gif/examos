# SARMS — Build & Install Guide
# React + Vite + PHP + MySQL on XAMPP

## What You Have
- A proper React project (not CDN-based)
- PHP backend that saves everything to MySQL in real time
- Works on XAMPP on your PC

---

## STEP 1 — Install Node.js (if not already done)
Download from https://nodejs.org — choose the LTS version.
After installing, open Command Prompt and check:
  node --version   (should show v18 or higher)
  npm --version    (should show 9 or higher)

---

## STEP 2 — Set Up the Project Folder
Copy the sarms-react folder you downloaded to anywhere on your PC.
Example: C:\Users\YourName\Desktop\sarms-react\

The folder should contain:
  package.json
  vite.config.js
  index.html
  src\
      main.jsx
      App.jsx
  htaccess-for-dist.txt

---

## STEP 3 — Install Dependencies
Open Command Prompt (or PowerShell).
Navigate to the project folder:
  cd C:\Users\YourName\Desktop\sarms-react

Run:
  npm install

This downloads React and Vite (about 30 seconds, needs internet).

---

## STEP 4 — Build the App
Still in the same folder, run:
  npm run build

This creates a "dist" folder with optimised HTML, CSS and JS files.
It takes about 10-20 seconds.

---

## (Optional) Faster Dev Workflow — for making code changes

If you're actively editing the app (not just running it), building after every
change is slow. Instead:

1. Copy the "api" folder into a subfolder of C:\xampp\htdocs\ once, e.g.
   C:\xampp\htdocs\sarms-react\api\  (the folder name matters — see step 2)
2. Open vite.config.js and check the "server.proxy" target matches that exact
   folder name (http://localhost/sarms-react). If your XAMPP folder is named
   something else (e.g. sarms-reactt with a double t), change it here too —
   otherwise every API call will silently fail.
3. Make sure XAMPP's Apache + MySQL are both running (Step 5 below).
4. In your PROJECT source folder (not htdocs — this can be anywhere, e.g.
   your Desktop), run:
     npm install      (only needed once, or after pulling new dependencies)
     npm run dev
5. Open the URL it prints — normally http://localhost:5173 — NOT
   http://localhost/sarms-react. The dev server runs on its own port and
   proxies API calls through to XAMPP; opening the project folder directly
   through Apache (localhost/sarms-react/) will 404 on main.jsx, because
   Apache can't run unbuilt JSX.
6. When you're done and ready to deploy, run `npm run build` and follow
   Step 7 onward below as normal — the dev workflow is just for editing.

---

## STEP 5 — Set Up XAMPP
1. Open XAMPP Control Panel
2. Click START next to Apache
3. Click START next to MySQL
   Both should turn green.

---

## STEP 6 — Create the Database
1. Open browser → go to: http://localhost/phpmyadmin
2. Click "Import" in the top menu
3. Click "Choose File" → select "sarms_database.sql"
4. Scroll down, click "Go"
5. You will see "sarms_db" appear in the left panel

---

## STEP 7 — Copy Files to XAMPP
1. Open File Explorer
2. Go to: C:\xampp\htdocs\
3. Create a new folder called: sarms
4. Open the "dist" folder from Step 4
5. Copy EVERYTHING inside dist\ into C:\xampp\htdocs\sarms\
   (copy index.html, assets folder, etc.)

6. Also copy the "api" folder into C:\xampp\htdocs\sarms\
   So you have: C:\xampp\htdocs\sarms\api\db.php

7. Rename htaccess-for-dist.txt to .htaccess
   Then copy it into C:\xampp\htdocs\sarms\
   (If Windows won't let you rename with a dot, use Command Prompt:
    rename htaccess-for-dist.txt .htaccess)

Final folder should look like:
  C:\xampp\htdocs\sarms\
      index.html
      assets\
          index-abc123.js
          index-abc123.css
      api\
          db.php
      .htaccess

---

## STEP 8 — Test the PHP API First
Before opening the app, test that PHP can reach the database.
Open browser and go to:
  http://localhost/sarms/api/db.php?action=ping

You should see:
  {"ok":true,"php":"8.x","db":"sarms_db"}

If you see that — everything is working.
If you see a 404 — db.php is in the wrong folder.
If you see a DB error — re-check Step 6.

---

## STEP 9 — Open the App
Go to: http://localhost/sarms

The app will load, connect to MySQL, and show the login page.

Default login:
  Email   : admin@school.com
  Password: admin@2024

IMPORTANT: Change these immediately after first login!
Go to Settings → My Profile → change name, email and password.

---

## STEP 10 — Configure Your School
After logging in as admin:
1. Go to Settings → Institution
2. Enter your school name, address, principal name
3. Upload your school logo and principal signature
4. Save Changes

All changes save to MySQL instantly and survive page reloads.

---

## Troubleshooting

PROBLEM: Browser shows "Database Connection Failed"
FIX: Check Step 8 — test the ping URL first.
     Make sure api\db.php exists inside C:\xampp\htdocs\sarms\api\

PROBLEM: Page shows 404 when refreshing
FIX: The .htaccess file is missing or mod_rewrite is not enabled.
     Open C:\xampp\apache\conf\httpd.conf
     Find: AllowOverride None (inside the htdocs Directory block)
     Change to: AllowOverride All
     Restart Apache in XAMPP.

PROBLEM: npm install fails
FIX: Check your internet connection. npm needs internet to download packages.
     Try: npm install --registry https://registry.npmjs.org

PROBLEM: 'vite' is not recognized as an internal or external command
FIX: node_modules isn't installed yet in this folder. Run "npm install"
     first, then try "npm run dev" or "npm run build" again.

PROBLEM: Browser console shows "Failed to load resource: main.jsx 404"
FIX: You're opening the raw project folder directly through Apache/XAMPP
     instead of a built one. Apache can't run unbuilt .jsx files. Either:
     (a) run "npm run build" and serve the "dist" folder's contents instead
         (see Step 7), or
     (b) use "npm run dev" and open the printed localhost:5173 URL, not
         the XAMPP URL — see the "Faster Dev Workflow" section above.

PROBLEM: Build fails with syntax error
FIX: Make sure Node.js is version 18 or higher.
     Run: node --version

PROBLEM: db.php shows blank page
FIX: Open C:\xampp\php\php.ini
     Find: display_errors = Off
     Change to: display_errors = On
     Restart Apache. Then open db.php?action=ping again.

---

## For WizHosting (Live Server)
After npm run build:
1. Upload everything inside dist\ to public_html\ via File Manager or FTP
2. Upload api\db.php to public_html\api\db.php
3. Create the database in cPanel → MySQL Databases
4. Import sarms_database.sql via cPanel phpMyAdmin
5. Edit api\db.php — change DB_USER, DB_PASS, DB_NAME to your cPanel values
6. Rename htaccess-for-dist.txt to .htaccess and upload to public_html\
7. Visit https://yourdomain.com
