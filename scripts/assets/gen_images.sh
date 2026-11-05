#!/bin/bash
OR="python3 /mnt/project-files/tools/openrouter/or.py"; M=meta/muse-image
STYLE="painterly oil painting, rich Belle Epoque atmosphere, warm brass and amber lamplight against deep navy blue shadows, cinematic lighting, highly detailed, no text, no letters, no words, no logos"
gen(){ $OR image "$2. $STYLE" --model $M --out img/$1.png --aspect "$3" > img/$1.log 2>&1 & }
gen title-maproom "Wide panoramic interior of a grand imperial map room at dusk around 1890: an enormous antique terrestrial globe on a brass stand at one side, a long war table covered with a world map, wooden fleet and army tokens, brass compasses and telegraph, tall arched windows behind showing a harbour with steamships and a distant airship in an orange sunset sky, calm open dark area in the upper center for a title overlay" 16:9
gen title-fleet "Wide panoramic seascape at golden hour: a line of 1900s steel battleships and steam cruisers with smoking funnels ploughing through heavy swells, signal flags fluttering, gulls, dramatic clouds lit amber from below, deep blue sea, calm sky area in the upper center for a title overlay" 16:9
gen title-expedition "Wide panoramic landscape at dawn: a long column of 1890s explorers, mule trains and mounted riders winding through a vast mountain pass, an airship drifting high above, mist in the valleys, sunlight breaking over snowy peaks, epic sense of scale, open sky in the upper center for a title overlay" 16:9
wait
gen crest-england "Heraldic crest emblem: a proud golden lion rampant on a deep royal purple shield with gold filigree border, centered, isolated on a plain very dark background, game emblem" 1:1
gen crest-germany "Heraldic crest emblem: a stern black and silver eagle with spread wings on a steel-grey shield with gold filigree border, centered, isolated on a plain very dark background, game emblem" 1:1
gen crest-france "Heraldic crest emblem: a proud gallic rooster in gold on an emerald green shield with gold filigree border, centered, isolated on a plain very dark background, game emblem" 1:1
gen crest-usa "Heraldic crest emblem: a bald eagle with spread wings above a sky-blue shield with white stars and gold filigree border, centered, isolated on a plain very dark background, game emblem" 1:1
gen crest-japan "Heraldic crest emblem: an elegant red-crowned crane in flight before a golden sun disc on a golden yellow shield with filigree border, centered, isolated on a plain very dark background, game emblem" 1:1
gen crest-russia "Heraldic crest emblem: a mighty brown bear standing on a crimson red shield with gold filigree border, centered, isolated on a plain very dark background, game emblem" 1:1
wait
gen ev-naval "Dramatic naval battle at sea around 1900: two battleship lines exchanging broadsides, muzzle flashes, towering water spouts, smoke drifting over the waves, stormy amber sky" 16:9
gen ev-land "Dramatic land battle around 1890: field artillery firing across a hilly plain, smoke clouds, infantry lines advancing with banners, glowing sunset, epic but not gory" 16:9
gen ev-coup "A tense palace square at night around 1890: a crowd with torches and banners surging toward palace gates, guards stepping aside, dramatic shadows, revolutionary mood, not violent" 16:9
gen ev-spy "A secret agent in a dim study around 1890 reading a decoded telegram by a green banker lamp, maps and photographs pinned on the wall, rain on the window, noir mood" 16:9
gen ev-peace "Diplomats in frock coats signing a peace treaty at a long table in a gilded hall, quills and wax seals, chandeliers, soft golden light" 16:9
gen ev-victory "Grand victory parade on a city boulevard around 1900, crowds waving flags, fireworks over a domed palace at dusk, confetti, triumphant mood" 16:9
gen ev-defeat "An abandoned field camp in the rain at dusk around 1890, a torn banner lying in the mud beside a broken cannon wheel, melancholy, muted colors" 16:9
gen ev-newyear "An old printing press room at night around 1890, freshly printed newspapers flying off the press, warm lamplight, ink and paper, bustling atmosphere" 16:9
gen ev-capture "Soldiers raising a large banner on the walls of a captured hilltop fortress at sunrise, smoke clearing below, heroic mood" 16:9
gen ev-war "A war council at night around 1890: generals in uniform leaning over a map table lit by lamplight, a messenger rushing in with a telegram, tension" 16:9
wait
