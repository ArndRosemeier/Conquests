#!/bin/bash
# Leader portraits for the Diplomacy panel (one per power and scenario start year).
OR="python3 /mnt/project-files/tools/openrouter/or.py"; M=meta/muse-image
STYLE="formal head-and-shoulders portrait, painterly oil painting in the style of a 19th century state portrait, warm brass and amber lamplight, deep navy blue background, dignified, highly detailed, no text, no letters, no words, no frame"
gen(){ $OR image "$2. $STYLE" --model $M --out img/$1.png --aspect 1:1 > img/$1.log 2>&1 & }
mkdir -p img
gen leader-england-1880 "Queen Victoria of the United Kingdom around 1880, elderly woman in black mourning dress with white lace widow's cap and small diamond crown, blue sash of the Order of the Garter, stern composed expression"
gen leader-germany-1880 "Otto von Bismarck, German Chancellor around 1880, bald elderly man with large white walrus moustache, dark Prussian cuirassier uniform with spiked helmet held under arm, iron cross, piercing gaze"
gen leader-france-1880 "Jules Grevy, President of the French Third Republic around 1880, elderly man with white chin beard and no moustache, black frock coat with red sash of the Legion of Honour, calm lawyerly expression"
gen leader-usa-1880 "Rutherford B. Hayes, President of the United States around 1880, man with a full long greyish brown beard, black frock coat and white shirt, earnest expression"
gen leader-japan-1880 "Emperor Meiji of Japan around 1880, young man with a short dark beard and moustache, Western-style dark military dress uniform with gold epaulettes and orders, composed regal expression"
gen leader-russia-1880 "Tsar Alexander II of Russia around 1880, older man with grey mutton chop whiskers and moustache, white and red Russian imperial military uniform with gold epaulettes and blue sash, regal expression"
wait
gen leader-england-1914 "H. H. Asquith, Prime Minister of the United Kingdom in 1914, clean-shaven older man with swept-back white hair, dark frock coat and high white collar, shrewd expression"
gen leader-germany-1914 "Kaiser Wilhelm II of Germany in 1914, man with upturned waxed moustache, Prussian field-grey military uniform with orders and spiked helmet, imperious expression"
gen leader-france-1914 "Raymond Poincare, President of France in 1914, man with a short pointed grey beard and moustache, black formal coat with red sash of the Legion of Honour, resolute expression"
gen leader-usa-1914 "Woodrow Wilson, President of the United States in 1914, clean-shaven man with a long face and pince-nez spectacles, dark suit and high white collar, thoughtful expression"
gen leader-japan-1914 "Emperor Taisho of Japan in 1914, man with a thin upturned moustache, dark Japanese imperial military dress uniform with gold braid and orders, reserved expression"
gen leader-russia-1914 "Tsar Nicholas II of Russia in 1914, man with a neat brown beard and moustache, Russian military tunic with orders and medals, calm gentle expression"
wait
