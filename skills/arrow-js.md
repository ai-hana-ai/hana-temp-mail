# Arrow-JS Agent Skill for `hana-temp-mail`

Panduan ini khusus untuk agent yang mengubah [src/ui.tsx](/home/radya/.openclaw/workspace/projects/hana-temp-mail/src/ui.tsx). Project ini tidak memakai React di client. UI interaktif dirender sebagai string script yang menjalankan Arrow-JS langsung di browser.

## 1. Mental Model

- `HomePage()` menghasilkan HTML server-side plus satu string `appScript`.
- Semua state interaktif hidup di `const state = reactive({...})`.
- Arrow-JS hanya melacak dependency yang benar-benar disentuh saat render/effect berjalan. Kalau dependency tersebar di banyak helper tanpa snapshot yang jelas, subtree bisa nyangkut pada render lama.

## 2. Template Structure yang Aman

- Untuk template client, selalu pakai `html\`...\`` dari `@arrow-js/core`.
- Untuk nilai reaktif di template, bungkus dengan fungsi:
  - benar: `\${() => state.status}`
  - raw literal/non-reaktif: `\${state.skeletonItems.map(...)}`
- Saat satu subtree harus benar-benar reset saat mailbox/loading berubah, beri `.key(...)` yang stabil dan turunkan dari state yang memang menentukan lifecycle subtree itu.
- Kalau butuh beberapa field state sekaligus dalam satu render branch, ambil snapshot dulu di awal helper render supaya Arrow melacak perubahan secara konsisten.

## 3. Reactivity Rules di Project Ini

- Mailbox switch harus dianggap sebagai lifecycle baru:
  - tutup SSE lama
  - batalkan fetch inbox lama
  - reset selection email
  - kosongkan `state.emails` kalau mailbox berubah
- Hindari `await loadEmails()` langsung di `activateInbox()` karena UI transition bisa ikut tersandera fetch network. Jalankan non-blocking dengan `void loadEmails(...).catch(...)`.
- Semua status async harus dilindungi token run (`activateInboxSeq`, `inboxLoadSeq`) supaya response lama tidak menimpa mailbox aktif yang baru.
- Jika fetch bisa overlap, simpan `AbortController` di state dan abort request lama sebelum request inbox baru dimulai.

## 4. Escaping dan Penulisan String

- File ini berisi string JavaScript di dalam TSX. Error paling sering datang dari escape yang salah.
- Gunakan `JSON.stringify(value)` untuk menyuntikkan string/config dari server ke script client.
- Untuk regex dan escape sequence di dalam `appScript`, pastikan backslash digandakan:
  - contoh: `\\s`, `\\d`, `\\'`
- Hindari nested template literal yang rumit. Kalau string HTML/CSP panjang, bangun lewat array `.join('')` seperti `buildHtmlDocument()`.
- Jangan sisipkan backtick liar ke dalam string client kecuali benar-benar perlu.

## 5. Event Handling

- Binding input Arrow-JS standar:
  - `.value="\${() => state.localPart}"`
  - `@input="\${(e) => state.localPart = e.target.value}"`
- Jadikan `state` source of truth. Jangan fallback ke `document.getElementById(...).value` kecuali memang tidak ada opsi lain.
- Event SSE/fetch harus selalu cek apakah masih milik mailbox aktif sebelum update UI.

## 6. Render Checklist sebelum Commit

- Ganti mailbox setelah inbox pertama terbuka: status harus bergerak, list lama harus bersih, inbox baru harus tetap bisa menerima update realtime.
- Refresh mailbox yang sama: selection/email detail tidak boleh reset lebih dari yang perlu.
- Empty state, skeleton, dan email list harus saling menggantikan secara deterministik.
- Kalau menambah string status/test source HTML, update assertion di `src/__tests__/index.test.ts`.
