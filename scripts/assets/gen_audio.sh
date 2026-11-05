#!/bin/bash
OR="python3 /mnt/project-files/tools/openrouter/or.py"
PRO=google/lyria-3-pro-preview; CLIP=google/lyria-3-clip-preview; SEED=bytedance-seed/seed-audio-1-0
mus(){ $OR music "$3" --model $2 --out music/$1.mp3 > music/$1.log 2>&1 & }
mus title $PRO "Grand cinematic orchestral main theme for a strategy game about rival empires in the 1880s to 1910s: opens with a distant solo trumpet call over soft timpani rolls, builds into a sweeping heroic march with full strings, French horns, brass fanfares and snare drums, a noble lyrical middle section, then a triumphant final restatement. Late-Romantic style, adventurous and inviting. Instrumental, no vocals."
mus campaign-1 $PRO "Calm, thoughtful orchestral background music for a turn-based grand strategy game set around 1890: gentle strings, warm woodwinds, soft harp arpeggios, a subtle pizzicato pulse, hints of a noble march theme, contemplative mood suitable for planning. Low intensity, loopable feel, no big climaxes. Instrumental, no vocals."
mus campaign-2 $PRO "Atmospheric orchestral music for a strategy game map screen, Belle Epoque era: slow piano and celesta melody over sustained strings, light military snare brushes, occasional distant horn calls, a sense of exploration and diplomacy, mysterious but warm. Low intensity, no big climaxes. Instrumental, no vocals."
mus war $PRO "Tense driving orchestral war music for a strategy game, era 1900: pounding timpani and low strings ostinato, urgent snare drums, brass stabs, rising tension, martial and dramatic but not horror. Instrumental, no vocals."
wait
mus victory $CLIP "Triumphant 30 second orchestral victory fanfare: bright brass fanfare, cymbal crashes, full orchestra, celebratory march ending on a big major chord. Instrumental, no vocals."
mus defeat $CLIP "Somber 30 second orchestral lament: solo cello and muted horn over soft low strings, slow funeral-march feel, dignified and melancholic, ending quietly. Instrumental, no vocals."
wait
sfx(){ $OR sfx "$2" --model $SEED --out sfx/$1.mp3 > sfx/$1.log 2>&1 & }
sfx cannon "The sound of a single heavy 19th century cannon firing, a deep boom followed by a rolling echo"
sfx battle "The sound of a distant land battle: rolling artillery fire, rifle volleys crackling, faint bugle in the distance"
sfx naval "The sound of large naval guns firing a broadside at sea, booming blasts and splashing water spouts"
sfx horn "The sound of a deep steamship horn blowing once in a harbour"
sfx coins "The sound of a handful of gold coins dropping onto a wooden table and clinking"
sfx stamp "The sound of a heavy rubber stamp pressed firmly onto paper on a wooden desk"
sfx telegraph "The sound of a telegraph key tapping a short burst of morse code"
wait
sfx crowd "The sound of an agitated crowd cheering and shouting in a city square"
sfx drums "The sound of military snare drums playing a short marching cadence"
sfx fanfare "The sound of a short bright bugle fanfare announcing a victory"
sfx bell "The sound of a large church bell ringing twice"
sfx page "The sound of a newspaper page being turned quickly"
sfx click "The sound of a soft wooden click like a game token placed on a board"
sfx build "The sound of hammers on metal and a steam whistle in a busy shipyard"
wait
vo(){ $OR speech "$2" --model $SEED --out vo/$1.mp3 --instructions "$3" > vo/$1.log 2>&1 & }
H="a confident, warm British herald announcing news in a grand hall, clear and unhurried"
vo welcome "Welcome to Conquests. The world awaits your ambition." "$H"
vo yourturn "Your turn, Excellency." "$H"
vo war "War has been declared!" "urgent, dramatic British herald, raised voice"
vo victory "Victory! Your empire stands supreme." "triumphant British herald, proud and loud"
vo defeat "Your empire has fallen." "somber, quiet British herald"
vo newyear "A new year dawns. The treasury is replenished." "$H"
wait
