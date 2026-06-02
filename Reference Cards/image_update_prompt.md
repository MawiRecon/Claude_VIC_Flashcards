We updated the vehicle flashcard images. Several images that were stored as two
vertically-sliced halves have been combined into single images, and the affected
vehicles' views were renumbered so each vehicle now has a clean sequential set
(View1–View4). Please update the program to use the new filenames below.

Rules:
- All paths are in the per-country "Extracted Images" folders (NATO, Russia).
- Extensions: every active image is .jpg EXCEPT `NATO_Coyote_View4.png`.
- The old sliced halves are retained on disk with an `_OLD` suffix but are NO LONGER
  used by the program — remove any references to them.
- Only the 7 vehicles below changed. All other vehicles are unchanged.

For each vehicle, here is the full old → new mapping (old filename = whatever the
program currently references):

NATO_Coyote  (was View1–6, now View1–4)
  - View1 + View2  -> combined -> NATO_Coyote_View1.jpg
  - View3 + View4  -> combined -> NATO_Coyote_View2.jpg
  - View5          -> renamed  -> NATO_Coyote_View3.jpg
  - View6          -> renamed  -> NATO_Coyote_View4.png   (note: .png)

NATO_HIMARS  (was View1–5, now View1–4)
  - View1          -> unchanged -> NATO_HIMARS_View1.jpg
  - View2 + View3  -> combined  -> NATO_HIMARS_View2.jpg
  - View4          -> renamed   -> NATO_HIMARS_View3.jpg
  - View5          -> renamed   -> NATO_HIMARS_View4.jpg

NATO_Paladin  (was View1–5, now View1–4)
  - View1          -> unchanged -> NATO_Paladin_View1.jpg
  - View2 + View3  -> combined  -> NATO_Paladin_View2.jpg
  - View4          -> renamed   -> NATO_Paladin_View3.jpg
  - View5          -> renamed   -> NATO_Paladin_View4.jpg

Russia_BMP-2  (was View1–5, now View1–4)
  - View1 + View2  -> combined  -> Russia_BMP-2_View1.jpg
  - View3          -> renamed   -> Russia_BMP-2_View2.jpg
  - View4          -> renamed   -> Russia_BMP-2_View3.jpg
  - View5          -> renamed   -> Russia_BMP-2_View4.jpg

Russia_Havoc  (was View1–5, now View1–4)
  - View1          -> unchanged -> Russia_Havoc_View1.jpg
  - View2 + View3  -> combined  -> Russia_Havoc_View2.jpg
  - View4          -> renamed   -> Russia_Havoc_View3.jpg
  - View5          -> renamed   -> Russia_Havoc_View4.jpg

Russia_T-72B3  (was View1–5, now View1–4)
  - View1          -> unchanged -> Russia_T-72B3_View1.jpg
  - View2          -> unchanged -> Russia_T-72B3_View2.jpg
  - View3          -> unchanged -> Russia_T-72B3_View3.jpg
  - View4 + View5  -> combined  -> Russia_T-72B3_View4.jpg

Russia_T-80U  (was View1–5, now View1–4)
  - View1          -> unchanged -> Russia_T-80U_View1.jpg
  - View2          -> unchanged -> Russia_T-80U_View2.jpg
  - View3 + View4  -> combined  -> Russia_T-80U_View3.jpg
  - View5          -> renamed   -> Russia_T-80U_View4.jpg

Net result: every one of these 7 vehicles now has exactly View1, View2, View3, View4
as its active images. Update all references accordingly and ignore/remove any
`*_OLD.*` files.
