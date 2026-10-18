# اجرا روی ویندوز (Laragon / XAMPP / Node مستقیم)

1. Node.js نسخه‌ی **LTS (۲۰ یا ۲۲)** یا ۲۴ نصب کنید و در پوشه‌ی پروژه اجرا کنید:
   ```
   npm install
   npm start
   ```
   از نسخه‌ی ۲٫۵٫۱ `better-sqlite3` نسخه‌ی ۱۲ است که برای Node 20/22/24 فایل آماده دارد و نیازی به کامپایل نیست.
2. اگر در ویزارد خطای «Could not locate the bindings file» دیدید:
   - پروژه را به آخرین نسخه ببرید و `npm install` را دوباره اجرا کنید (پوشه‌ی `node_modules` را پاک کنید اگر با Node دیگری نصب شده بود)؛
   - یا `npm rebuild better-sqlite3`؛
   - اگر کامپایل خواست: Visual Studio Build Tools (Desktop development with C++) + Python؛
   - یا در مرحله‌ی پایگاه‌داده **MySQL** را انتخاب کنید (در لاراگون: کاربر `root` بدون رمز، میزبان `127.0.0.1`، یک پایگاه‌داده‌ی خالی بسازید).
3. اگر Node را عوض کردید، همیشه `npm rebuild` بزنید.
