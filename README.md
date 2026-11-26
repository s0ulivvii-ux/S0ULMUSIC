# S0UL Music

بوت أغاني لديسكورد بالعربي والإنجليزي. كل سيرفر له مشغّل وقائمة مشتركة بين اللغتين. لغة بطاقة المشغّل تتحدد من أول أمر تشغيل في الجلسة، ورد كل أمر يطلع بلغته.

| العربية | English | الاستخدام |
| --- | --- | --- |
| `/شغل` | `/play` | تشغيل من رابط أو اسم وإضافة الأغاني للقائمة |
| `/تخط` | `/skip` | تخطي الأغنية الحالية |
| `/صف` | `/queue` | عرض قائمة الانتظار |
| `/وقف` | `/stop` | إيقاف التشغيل ومغادرة الروم |
| `/مؤقت` | `/pause` | إيقاف مؤقت أو استئناف |
| `/سابق` | `/back` | الرجوع للأغنية السابقة |

البانر GIF فيه نجوم بيضاء نازلة وفاينل يدور جنب اسم الأغنية. عند الإيقاف المؤقت يثبت الفاينل وتستمر النجوم. تحديثات التشغيل تحصل في نفس البطاقة. اسم الأغنية يفتح رابطها، واسم الفنان يكون قابلًا للضغط متى ما أرجع المصدر رابط الفنان. أزرار التحكم تعمل لأعضاء الروم الصوتي نفسه.

## التشغيل من VS Code

1. في VS Code اضغطي `⌘⇧P` على الماك واختاري `Git: Clone`. الصقي `https://github.com/s0ulivvii-ux/S0ULMUSIC.git` واختاري مكان حفظ المشروع. سجّلي الدخول إلى GitHub إذا طلب منك، وبعد الاستنساخ اختاري `Open`.
2. استخدمي Node.js 24 أو أحدث. لتشغيل خادم الصوت محليًا شغّلي Docker Desktop.
3. أنشئي تطبيق بوت من [Discord Developer Portal](https://discord.com/developers/applications). ثبتيه على سيرفر التجربة بصلاحيتي `bot` و`applications.commands`. خلي البوت يقدر يشوف روم الأوامر ويرسل رسائل ومرفقات فيه، ويقدر يتصل ويتكلم في الروم الصوتي.
4. انسخي `.env.example` باسم `.env`، وحطي التوكن في `DISCORD_TOKEN` وكلمة مرور من اختيارك في `LAVALINK_PASSWORD`. حطي ID سيرفر التجربة في `DISCORD_GUILD_ID` عشان تنزل الأوامر فيه. لو تركتيه فاضي تتسجل الأوامر على مستوى التطبيق.
5. انسخي `application.example.yml` باسم `application.yml`. بعدها شغّلي من Terminal داخل VS Code:

   ```bash
   npm install
   docker compose up -d
   npm start
   ```

6. انتظري ظهور `Lavalink ready` و`registered 12 commands`، وادخلي روم صوتي عادي وجربي `/شغل` أو `/play`.

إذا عندك خادم Lavalink خاص جاهز يدعم DAVE (مثل 4.2.2)، استخدمي رابطه وكلمة مروره في `.env` وتخطّي إعداد Docker. على Botkeep ارفعي ملفات المشروع، عيّني متغيرات البيئة، واستخدمي `npm start` مع خادم Lavalink منفصل إذا الاستضافة ما توفر تشغيل Docker.

## المصادر

- إعداد المشروع يفعّل YouTube وSoundCloud وBandcamp وTwitch وVimeo في Lavalink. البحث بالاسم يستخدم YouTube افتراضيًا. تقدرين تغيرين `SEARCH_PREFIX` إلى `scsearch`.
- لتفعيل Spotify غيّري `plugins.lavasrc.sources.spotify` إلى `true` في `application.yml` وأضيفي بيانات تطبيق Spotify في `clientId` و`clientSecret`. لتفعيل Apple Music غيّري `applemusic` إلى `true` وأضيفي رمز Apple Music API في `mediaAPIToken`. بعدها شغّلي `docker compose restart lavalink`.
- Spotify وApple Music يستخدمان بيانات الأغنية الأصلية للعثور على صوت مطابق من مصدر تشغيل متاح. الرابط المعروض يرجع إلى المصدر الأصلي إذا وفره Lavalink. توفر التشغيل يعتمد على الرابط والمنصة وإعدادات خادم الصوت.
- للمصادر الإضافية فعّلي الإضافة المناسبة على خادم Lavalink ثم ضيفي نطاق المصدر إلى `EXTRA_SOURCE_HOSTS` إذا احتجتي. دعم أي رابط يعتمد على وجود مزوّد يدعمه. خلي التوكن والمفاتيح في ملفات الإعداد المحلية.

[إعداد Lavalink](https://lavalink.dev/getting-started/docker.html) · [توثيق مصادر LavaSrc](https://github.com/topi314/LavaSrc)

## معاينة التصميم

بعد `npm install` شغّلي `npm run preview` وافتحي `preview.gif` من VS Code. المعاينة تشتغل بدون توكن أو اتصال بديسكورد.
