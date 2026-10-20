# STRAT FF By RxJAPP

Web editor untuk menyusun strategi turnamen Free Fire di berbagai map.

## Fitur

- Gambar jalur, zona, area, dan label di atas map.
- Kelola match dan plan.
- Zoom dan geser map, termasuk dukungan layar sentuh.
- Presentasi dan ekspor strategi ke PNG.
- Draft tersimpan di penyimpanan browser pada perangkat yang digunakan.

## Menjalankan lokal

Aplikasi statis tanpa proses build atau dependency. Sajikan folder proyek menggunakan ekstensi server lokal di editor, lalu buka alamat lokal yang ditampilkan oleh server tersebut.

## Deploy ke Vercel

Konfigurasi [vercel.json](./vercel.json) menyiapkan proyek sebagai situs statis tanpa framework, install, atau build command. Import repository ini ke Vercel, atau deploy dari folder proyek menggunakan Vercel CLI.

Strategi disimpan di `localStorage`, jadi tidak otomatis tersinkron antar browser/perangkat.
