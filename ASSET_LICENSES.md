# Asset และสัญญาอนุญาต

| ชื่อ | ผู้สร้าง | ต้นทาง | สัญญาอนุญาตและเครดิต | ไฟล์ |
| --- | --- | --- | --- | --- |
| โมเดลตาชั่ง หอคอย จาน คริสตัล วงแหวน และวัตถุคณิตศาสตร์ | Balance Quest | สร้างสำหรับโครงการนี้ | Asset ต้นฉบับ ไม่มีเครดิตบุคคลภายนอก | `src/scene/`, `src/styles/app.css` |
| เสียงสังเคราะห์ เอฟเฟกต์ และดนตรีพื้นหลัง | Balance Quest | ทำนองและเครื่องดนตรีสังเคราะห์สำหรับโครงการนี้ | Asset ต้นฉบับ ไม่มีเครดิตบุคคลภายนอก | `src/features/audio/audio.ts`, `src/features/audio/soundtrack.ts` |
| Hand Landmarker float16/1 | Google MediaPipe | [ไฟล์จาก Google](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task) · [รุ่นโมเดล SHA-256 และสัญญาอนุญาต](https://huggingface.co/litert-community/MediaPipe-HandLandmarker-Full) | Apache-2.0 รักษาประกาศสัญญาอนุญาต ไฟล์โมเดลไม่ได้แก้ไข | `public/mediapipe/hand_landmarker.task`, `public/licenses/MediaPipe.txt` |
| Tasks Vision JavaScript และ WASM 0.10.32 | Google MediaPipe | [โครงการ MediaPipe](https://github.com/google-ai-edge/mediapipe) | Apache-2.0 รักษาประกาศสัญญาอนุญาต | `public/mediapipe/wasm/`, `public/mediapipe/vision-worker-bundle.js`, `public/licenses/MediaPipe.txt` |
| Noto Sans Thai | Noto Project Authors | [Noto Thai](https://github.com/notofonts/thai) · [Fontsource](https://fontsource.org/fonts/noto-sans-thai) | SIL OFL 1.1 รักษาข้อความลิขสิทธิ์และสัญญาอนุญาต | `dist/assets/noto-sans-thai-*`, `public/licenses/npm/NotoSansThai.txt` |
| KaTeX และฟอนต์ที่กระจายมากับแพ็กเกจ | KaTeX contributors, Design Science, Inc. และ Khan Academy | [KaTeX](https://github.com/KaTeX/KaTeX) | โค้ด MIT ฟอนต์ SIL OFL 1.1 ตามตารางชื่อในไฟล์ฟอนต์ รักษาข้อความลิขสิทธิ์และสัญญาอนุญาต | `dist/assets/KaTeX_*`, `public/licenses/npm/KaTeX.txt`, `public/licenses/KaTeX-Fonts.txt` |
| ไอคอน Lucide | Lucide contributors และ Feather contributors | [Lucide license](https://github.com/lucide-icons/lucide/blob/main/LICENSE) | ISC/MIT รักษาข้อความลิขสิทธิ์และสัญญาอนุญาต | ไอคอนในไฟล์ TSX, `public/licenses/npm/Lucide.txt` |
| Three.js และ RoundedBoxGeometry | Three.js Authors | [Three.js](https://github.com/mrdoob/three.js) | MIT รักษาข้อความลิขสิทธิ์และสัญญาอนุญาต | `src/scene/`, `public/licenses/npm/Three.txt` |
| React Three Fiber | Poimandres | [React Three Fiber](https://github.com/pmndrs/react-three-fiber) | MIT รักษาข้อความลิขสิทธิ์และสัญญาอนุญาต | `src/scene/ThreeScene.tsx`, `public/licenses/ReactThreeFiber.txt` |

SHA-256 ของ `hand_landmarker.task` คือ `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` ไฟล์ License ที่คัดลอกมาจะอยู่ใน `dist/licenses/` ด้วย
