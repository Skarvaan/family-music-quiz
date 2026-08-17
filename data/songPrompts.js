/* =========================================================
   Family Music Quiz · Prompt-Bibliothek v2
   -----------------------------------------------------
   Struktur pro Eintrag:
     id     eindeutig, wird für "nicht wiederholen" gebraucht
     text   der Prompt selbst
     theme  Themengruppe (für Durchmischung, damit nicht 5x
            dasselbe Motiv hintereinander kommt)
     tone   "family"  = für jede Runde, auch mit Kindern
            "deep"    = persönlich/emotional, braucht Vertrauen
            "spicy"   = frech/erwachsen, eher Freundesrunde
   Die Auswahl-Logik (js/modes.js -> FMQ.promptBag) zieht ohne
   Zurücklegen und vermeidet zusätzlich, dass zwei Prompts
   desselben Themas direkt aufeinander folgen.
   ========================================================= */

window.FMQ_SONG_PROMPTS = {
  version: 2,

  themes: {
    erinnerung: "Erinnerung",
    gefuehl: "Gefühl",
    alltag: "Alltag",
    menschen: "Menschen",
    geschmack: "Geschmack",
    gestaendnis: "Geständnis",
    szenario: "Szenario",
    selbstbild: "Selbstbild",
    kino: "Kino & Szene",
    urteil: "Urteil",
    wettkampf: "Wettkampf",
    absurd: "Absurd",
    zeit: "Zeit & Epoche"
  },

  tones: {
    family: { label: "Für alle", hint: "Auch mit Kindern und Großeltern entspannt spielbar." },
    deep: { label: "Persönlich", hint: "Emotionale Fragen. Schön in vertrauter Runde." },
    spicy: { label: "Frech", hint: "Etwas frecher. Eher Freundesrunde als Familienfeier." }
  },

  /* =======================================================
     SONG-GESCHICHTEN
     Alle wählen gleichzeitig einen Song aus der eigenen
     Playlist. Bewusst unterschiedliche Satzformen:
     Frage, Szenario, Auftrag, Superlativ, Geständnis.
     ======================================================= */
  storyPrompts: [
    // ---- Erinnerung -------------------------------------
    { id: "st_sommer_jahr", text: "Ein Sommer, den du noch genau vor dir siehst. Welcher Song lief damals?", theme: "erinnerung", tone: "family" },
    { id: "st_ruecksitz", text: "Du sitzt wieder hinten im Auto deiner Eltern. Was läuft vorne?", theme: "erinnerung", tone: "family" },
    { id: "st_erste_cd", text: "Der erste Song, den du dir bewusst selbst ausgesucht hast.", theme: "erinnerung", tone: "family" },
    { id: "st_klassenfahrt", text: "Klassenfahrt, Bus, viel zu laute Boxen. Welcher Song?", theme: "erinnerung", tone: "family" },
    { id: "st_kueche_eltern", text: "In welcher Küche lief dieser Song, und wer hat mitgesungen?", theme: "erinnerung", tone: "family" },
    { id: "st_ort_zurueck", text: "Ein Song, der dich an einen Ort zurückbringt. Wohin?", theme: "erinnerung", tone: "family" },
    { id: "st_letzter_urlaub", text: "Der Soundtrack deines letzten schönen Urlaubs.", theme: "erinnerung", tone: "family" },
    { id: "st_geruch", text: "Ein Song, bei dem du fast etwas riechen kannst. Was?", theme: "erinnerung", tone: "deep" },
    { id: "st_verlorene_freundschaft", text: "Ein Song, der zu einer Person gehört, mit der du keinen Kontakt mehr hast.", theme: "erinnerung", tone: "deep" },
    { id: "st_silvester", text: "Welcher Song gehört für dich zu einem Jahreswechsel?", theme: "erinnerung", tone: "family" },
    { id: "st_kindergeburtstag", text: "Ein Song, der auf deinem Kindergeburtstag hätte laufen können.", theme: "erinnerung", tone: "family" },

    // ---- Gefühl -----------------------------------------
    { id: "st_gaensehaut", text: "Bei welchem Song bekommst du zuverlässig Gänsehaut, und an welcher Stelle?", theme: "gefuehl", tone: "family" },
    { id: "st_traurig_gut", text: "Ein Song, der traurig ist und dir trotzdem guttut.", theme: "gefuehl", tone: "deep" },
    { id: "st_sofort_besser", text: "Dir geht es mies. Welche drei Minuten helfen wirklich?", theme: "gefuehl", tone: "deep" },
    { id: "st_wut", text: "Ein Song für den Moment, in dem du richtig sauer bist.", theme: "gefuehl", tone: "family" },
    { id: "st_unbesiegbar", text: "Welcher Song macht dich für vier Minuten unbesiegbar?", theme: "gefuehl", tone: "family" },
    { id: "st_ruhig_werden", text: "Der Song, den du auflegst, wenn alles zu viel ist.", theme: "gefuehl", tone: "deep" },
    { id: "st_heimweh", text: "Ein Song, der nach Zuhause klingt.", theme: "gefuehl", tone: "family" },
    { id: "st_verliebt", text: "Ein Song, der klingt wie frisch verliebt sein.", theme: "gefuehl", tone: "family" },
    { id: "st_augen_zu", text: "Bei welchem Song machst du automatisch die Augen zu?", theme: "gefuehl", tone: "family" },
    { id: "st_traene", text: "Ein Song, bei dem du dich nicht ganz im Griff hast.", theme: "gefuehl", tone: "deep" },
    { id: "st_stolz", text: "Ein Song, der klingt, wie sich Stolz anfühlt.", theme: "gefuehl", tone: "family" },

    // ---- Alltag -----------------------------------------
    { id: "st_kochen", text: "Soundtrack fürs Kochen an einem Freitagabend.", theme: "alltag", tone: "family" },
    { id: "st_putzen", text: "Was läuft, wenn du in dreißig Minuten die ganze Wohnung machst?", theme: "alltag", tone: "family" },
    { id: "st_zug_verspaetet", text: "Zug fällt aus, es nieselt, vierzig Minuten Wartezeit. Was hörst du?", theme: "alltag", tone: "family" },
    { id: "st_montag_7uhr", text: "Montag, 7 Uhr, es ist dunkel. Welcher Song macht das erträglich?", theme: "alltag", tone: "family" },
    { id: "st_spaziergang", text: "Ein Song für einen Spaziergang allein.", theme: "alltag", tone: "family" },
    { id: "st_fahrrad_wind", text: "Rückenwind auf dem Fahrrad. Was läuft im Ohr?", theme: "alltag", tone: "family" },
    { id: "st_konzentration", text: "Musik, bei der du wirklich arbeiten kannst, nicht nur so tust.", theme: "alltag", tone: "family" },
    { id: "st_nachtfahrt", text: "Autobahn, halb eins nachts, kaum Verkehr. Welcher Song?", theme: "alltag", tone: "family" },
    { id: "st_einschlafen", text: "Der letzte Song vor dem Einschlafen.", theme: "alltag", tone: "family" },
    { id: "st_dusche", text: "Welchen Song singst du unter der Dusche lauter, als du zugeben würdest?", theme: "alltag", tone: "family" },
    { id: "st_warteschleife", text: "Ein Song, der jede Telefon-Warteschleife retten würde.", theme: "alltag", tone: "family" },
    { id: "st_grillabend", text: "Der Song, der auf jedem guten Grillabend laufen sollte.", theme: "alltag", tone: "family" },

    // ---- Menschen ---------------------------------------
    { id: "st_person_hier", text: "Wähle einen Song, der zu einer Person hier in der Runde passt. Noch nicht verraten, wem.", theme: "menschen", tone: "family" },
    { id: "st_mama_papa", text: "Ein Song, den du mit deinen Eltern verbindest.", theme: "menschen", tone: "family" },
    { id: "st_beste_freundin", text: "Der Song deiner längsten Freundschaft.", theme: "menschen", tone: "family" },
    { id: "st_geschwister", text: "Ein Song, über den du dich mit deinen Geschwistern streiten würdest.", theme: "menschen", tone: "family" },
    { id: "st_kennenlernen", text: "Welchen Song würdest du jemandem vorspielen, der dich verstehen will?", theme: "menschen", tone: "deep" },
    { id: "st_fremde_person", text: "Ein Song, den du gern mit einer fremden Person teilen würdest.", theme: "menschen", tone: "family" },
    { id: "st_kind_zeigen", text: "Ein Song, den ein Kind unbedingt mal gehört haben sollte.", theme: "menschen", tone: "family" },
    { id: "st_widmung", text: "Wenn dieser Song eine Widmung hätte, an wen ginge sie?", theme: "menschen", tone: "deep" },
    { id: "st_versoehnung", text: "Ein Song, den du nach einem Streit auflegen würdest.", theme: "menschen", tone: "deep" },

    // ---- Geschmack --------------------------------------
    { id: "st_bestes_intro", text: "Der beste Songanfang in deiner Playlist. Die ersten zehn Sekunden zählen.", theme: "geschmack", tone: "family" },
    { id: "st_bester_refrain", text: "Welcher Refrain gewinnt gegen alle anderen?", theme: "geschmack", tone: "family" },
    { id: "st_beste_bassline", text: "Der beste Bass deiner Sammlung.", theme: "geschmack", tone: "family" },
    { id: "st_unterschaetzt", text: "Ein Song, der viel bekannter sein müsste.", theme: "geschmack", tone: "family" },
    { id: "st_kein_skip", text: "Der eine Song, den du nie überspringst. Wirklich nie.", theme: "geschmack", tone: "family" },
    { id: "st_ganzes_album", text: "Ein Song, wegen dem du das ganze Album gehört hast.", theme: "geschmack", tone: "family" },
    { id: "st_zufallsfund", text: "Dein bester Zufallsfund der letzten Zeit.", theme: "geschmack", tone: "family" },
    { id: "st_text_stark", text: "Welcher Songtext ist bei dir hängengeblieben?", theme: "geschmack", tone: "deep" },
    { id: "st_laut_aufdrehen", text: "Ein Song, der laut gehört werden muss, sonst zählt er nicht.", theme: "geschmack", tone: "family" },
    { id: "st_leise_gehoert", text: "Ein Song, der nur leise funktioniert.", theme: "geschmack", tone: "family" },
    { id: "st_nie_langweilig", text: "Ein Song, den du seit Jahren hörst und immer noch nicht satt hast.", theme: "geschmack", tone: "family" },
    { id: "st_instrument", text: "Ein Song wegen eines einzigen Instruments. Welches?", theme: "geschmack", tone: "family" },
    { id: "st_stimme", text: "Eine Stimme, der du beim Singen alles glaubst.", theme: "geschmack", tone: "family" },
    { id: "st_fremde_sprache", text: "Ein Song in einer Sprache, die du nicht sprichst.", theme: "geschmack", tone: "family" },

    // ---- Geständnis -------------------------------------
    { id: "st_totgehoert", text: "Gib zu: welchen Song hast du komplett totgehört?", theme: "gestaendnis", tone: "family" },
    { id: "st_peinlich_gefeiert", text: "Ein Song, den du früher gefeiert hast und heute nur noch halb.", theme: "gestaendnis", tone: "family" },
    { id: "st_heimlich_gut", text: "Welchen Song magst du, ohne es laut zu sagen?", theme: "gestaendnis", tone: "spicy" },
    { id: "st_falsch_mitgesungen", text: "Ein Song, dessen Text du jahrelang falsch gesungen hast.", theme: "gestaendnis", tone: "family" },
    { id: "st_keiner_kennt", text: "Ein Song, den hier garantiert niemand kennt. Beweise es.", theme: "gestaendnis", tone: "family" },
    { id: "st_zu_spaet_entdeckt", text: "Ein Song, den du viel zu spät entdeckt hast.", theme: "gestaendnis", tone: "family" },
    { id: "st_algorithmus", text: "Ein Song, den dir eine Empfehlung untergejubelt hat und der sitzt.", theme: "gestaendnis", tone: "family" },
    { id: "st_playlist_leiche", text: "Ein Song, der aus Versehen in deiner Playlist gelandet ist.", theme: "gestaendnis", tone: "family" },
    { id: "st_nur_wegen_serie", text: "Ein Song, den du nur wegen einer Serie oder eines Videos kennst.", theme: "gestaendnis", tone: "family" },
    { id: "st_verteidigen", text: "Welchen Song würdest du gegen alle hier verteidigen?", theme: "gestaendnis", tone: "spicy" },

    // ---- Szenario ---------------------------------------
    { id: "st_einlauf", text: "Du betrittst einen Raum und ein Song wird eingespielt. Welcher?", theme: "szenario", tone: "family" },
    { id: "st_letzter_song", text: "Die Party endet in vier Minuten. Du bestimmst den letzten Song.", theme: "szenario", tone: "family" },
    { id: "st_karaoke_nuechtern", text: "Karaoke, und du bist stocknüchtern. Was traust du dich?", theme: "szenario", tone: "family" },
    { id: "st_hochzeit_eroeffnung", text: "Ein Song für den ersten Tanz. Muss nicht deiner sein.", theme: "szenario", tone: "family" },
    { id: "st_marathon_km35", text: "Kilometer 35, die Beine sind leer. Welcher Song trägt dich?", theme: "szenario", tone: "family" },
    { id: "st_insel", text: "Eine einsame Insel, ein Song, kein Tausch. Welcher?", theme: "szenario", tone: "family" },
    { id: "st_zeitkapsel", text: "Du legst einen Song in eine Zeitkapsel für das Jahr 2075.", theme: "szenario", tone: "family" },
    { id: "st_alien_erklaeren", text: "Ein Besuch aus dem All will wissen, wie Menschen klingen. Was spielst du?", theme: "szenario", tone: "family" },
    { id: "st_aufwachen_lange", text: "Du wachst nach zehn Jahren Schlaf auf. Welcher Song holt dich zurück?", theme: "szenario", tone: "deep" },
    { id: "st_bewerbung", text: "Ein Song, der als Bewerbung für dich durchgehen würde.", theme: "szenario", tone: "family" },
    { id: "st_kein_strom", text: "Letzter Song vor dem Stromausfall. Was soll es sein?", theme: "szenario", tone: "family" },
    { id: "st_halle_einlauf", text: "Du läufst in eine Halle voller Leute ein. Was dröhnt aus den Boxen?", theme: "szenario", tone: "family" },

    // ---- Selbstbild -------------------------------------
    { id: "st_beschreibt_dich", text: "Ein Song, der dich besser beschreibt als drei Sätze über dich.", theme: "selbstbild", tone: "deep" },
    { id: "st_altes_ich", text: "Welchen Song würdest du deinem Ich mit 14 vorspielen?", theme: "selbstbild", tone: "deep" },
    { id: "st_zukunfts_ich", text: "Ein Song, den dein Ich in zehn Jahren noch hören soll.", theme: "selbstbild", tone: "deep" },
    { id: "st_aktuelles_kapitel", text: "Wie klingt gerade dein aktuelles Lebenskapitel?", theme: "selbstbild", tone: "deep" },
    { id: "st_wunsch_ich", text: "Ein Song, der klingt wie die Person, die du gern wärst.", theme: "selbstbild", tone: "deep" },
    { id: "st_abspann_leben", text: "Dein Leben ist ein Film. Was läuft im Abspann?", theme: "selbstbild", tone: "deep" },
    { id: "st_morgens_du", text: "Wie klingst du morgens vor dem ersten Kaffee?", theme: "selbstbild", tone: "family" },
    { id: "st_arbeitsmodus", text: "Ein Song, der klingt wie du, wenn du im Tunnel bist.", theme: "selbstbild", tone: "family" },

    // ---- Zeit -------------------------------------------
    { id: "st_song_2000er", text: "Der beste Song aus den 2000ern in deiner Playlist.", theme: "zeit", tone: "family" },
    { id: "st_song_vor_geburt", text: "Ein Song, der älter ist als du.", theme: "zeit", tone: "family" },
    { id: "st_letztes_jahr", text: "Der Song, der dein letztes Jahr geprägt hat.", theme: "zeit", tone: "family" },
    { id: "st_letzte_woche", text: "Was hast du in den letzten sieben Tagen am häufigsten gehört?", theme: "zeit", tone: "family" },
    { id: "st_gut_gealtert", text: "Ein alter Song, der immer noch frisch klingt.", theme: "zeit", tone: "family" },
    { id: "st_winter", text: "Ein Song, der nach Dunkelheit und zu dünner Jacke klingt.", theme: "zeit", tone: "family" },
    { id: "st_fruehling", text: "Der erste warme Tag im Jahr. Welcher Song passt?", theme: "zeit", tone: "family" },
    { id: "st_herbststurm", text: "Regen gegen die Scheibe, Wind draußen. Was läuft drinnen?", theme: "zeit", tone: "family" },

    // ---- frech ------------------------------------------
    { id: "st_ex_playlist", text: "Ein Song, der auf keiner gemeinsamen Playlist mehr auftauchen darf.", theme: "gestaendnis", tone: "spicy" },
    { id: "st_red_flag", text: "Welcher Song wäre beim ersten Date eine Warnung?", theme: "menschen", tone: "spicy" },
    { id: "st_green_flag", text: "Welcher Song wäre beim ersten Date ein sehr gutes Zeichen?", theme: "menschen", tone: "family" },
    { id: "st_nachbarn_aergern", text: "Ein Song, mit dem du deine Nachbarn zur Weißglut bringen könntest.", theme: "szenario", tone: "spicy" },
    { id: "st_ueberbewertet", text: "Ein Song, den alle feiern und du nicht ganz verstehst.", theme: "geschmack", tone: "spicy" },
    { id: "st_ohne_worte_schicken", text: "Ein Song, den du jemandem schicken würdest, ohne etwas dazu zu schreiben.", theme: "menschen", tone: "spicy" }
  ],

  /* =======================================================
     SONG-DUELL
     Zwei eingereichte Songs treten gegeneinander an.
     Bewusst gemischt: Kino, Alltag, Charakterurteil,
     direkter Vergleich, Gefühl, Absurdes, Epoche.
     ======================================================= */
  duelPrompts: [
    // ---- Kino & Szene -----------------------------------
    { id: "du_abspann_traurig", text: "Welcher Song passt besser in den Abspann eines Films, der nicht gut ausgeht?", theme: "kino", tone: "family" },
    { id: "du_eroeffnung", text: "Welcher Song eröffnet den Film besser?", theme: "kino", tone: "family" },
    { id: "du_zeitlupe", text: "Welcher Song funktioniert besser in Zeitlupe?", theme: "kino", tone: "family" },
    { id: "du_verfolgungsjagd", text: "Welcher Song passt besser zu einer Verfolgungsjagd durch enge Gassen?", theme: "kino", tone: "family" },
    { id: "du_bosskampf", text: "Welcher Song gehört eher in den letzten Kampf eines Videospiels?", theme: "kino", tone: "family" },
    { id: "du_boesewicht", text: "Welcher Song kündigt besser an, dass jemand Böses den Raum betritt?", theme: "kino", tone: "family" },
    { id: "du_heldenmoment", text: "Welcher Song passt besser zu dem Moment, in dem doch noch alles gut wird?", theme: "kino", tone: "family" },
    { id: "du_regen_szene", text: "Welcher Song passt besser zu jemandem, der allein im Regen steht?", theme: "kino", tone: "deep" },
    { id: "du_montage", text: "Welcher Song trägt eine Montage besser, in der jemand über Wochen besser wird?", theme: "kino", tone: "family" },
    { id: "du_wiedersehen", text: "Welcher Song passt besser zu einem Wiedersehen am Bahnhof?", theme: "kino", tone: "family" },
    { id: "du_naturdoku", text: "Welcher Song liegt besser unter einer Naturdoku?", theme: "kino", tone: "family" },
    { id: "du_trailer", text: "Welcher Song würde einen Kinotrailer besser tragen?", theme: "kino", tone: "family" },

    // ---- Alltag -----------------------------------------
    { id: "du_spuelmaschine", text: "Welcher Song macht das Spülmaschine-Ausräumen erträglicher?", theme: "alltag", tone: "family" },
    { id: "du_stau", text: "Welcher Song hilft besser im Stau?", theme: "alltag", tone: "family" },
    { id: "du_umzug", text: "Welcher Song trägt einen Umzug besser durch den dritten Stock?", theme: "alltag", tone: "family" },
    { id: "du_fruehstueck_sonntag", text: "Welcher Song passt besser zum Sonntagsfrühstück?", theme: "alltag", tone: "family" },
    { id: "du_moebelhaus", text: "Welcher Song passt besser zu einem Möbelhaus an einem Samstag?", theme: "alltag", tone: "family" },
    { id: "du_wartezimmer", text: "Welcher Song wäre im Wartezimmer weniger schlimm?", theme: "alltag", tone: "family" },
    { id: "du_waescheberg", text: "Welcher Song bringt dich schneller durch den Wäscheberg?", theme: "alltag", tone: "family" },
    { id: "du_lernen", text: "Bei welchem Song könnte man eher lernen?", theme: "alltag", tone: "family" },
    { id: "du_kochen_gaeste", text: "Welcher Song läuft besser, während Gäste im Anmarsch sind?", theme: "alltag", tone: "family" },
    { id: "du_supermarkt", text: "Welcher Song passt besser in die Beschallung eines Supermarkts?", theme: "alltag", tone: "family" },
    { id: "du_zahnarzt", text: "Welchen Song würdest du dir beim Zahnarzt eher aufsetzen?", theme: "alltag", tone: "family" },
    { id: "du_joggen_regen", text: "Welcher Song bringt dich eher bei Nieselregen vor die Tür?", theme: "alltag", tone: "family" },

    // ---- Direkter Vergleich -----------------------------
    { id: "du_besseres_intro", text: "Welcher Song hat das bessere Intro?", theme: "wettkampf", tone: "family" },
    { id: "du_besserer_refrain", text: "Welcher Refrain bleibt länger hängen?", theme: "wettkampf", tone: "family" },
    { id: "du_besseres_ende", text: "Welcher Song hört besser auf?", theme: "wettkampf", tone: "family" },
    { id: "du_lauter", text: "Welcher Song verträgt mehr Lautstärke?", theme: "wettkampf", tone: "family" },
    { id: "du_karaoke_gewinn", text: "Mit welchem Song würdest du ein Karaoke-Duell eher gewinnen?", theme: "wettkampf", tone: "family" },
    { id: "du_mitsingen", text: "Bei welchem Song singt die Runde eher mit?", theme: "wettkampf", tone: "family" },
    { id: "du_tanzflaeche", text: "Welcher Song füllt die Tanzfläche schneller?", theme: "wettkampf", tone: "family" },
    { id: "du_ohrwurm", text: "Welcher Song geht schwerer wieder aus dem Kopf?", theme: "wettkampf", tone: "family" },
    { id: "du_oefter_hoeren", text: "Welchen Song hältst du hundert Mal hintereinander eher aus?", theme: "wettkampf", tone: "family" },
    { id: "du_live_sehen", text: "Welchen Song würdest du lieber live erleben?", theme: "wettkampf", tone: "family" },
    { id: "du_cover", text: "Von welchem Song würdest du lieber ein Cover hören?", theme: "wettkampf", tone: "family" },
    { id: "du_ohne_gesang", text: "Welcher Song funktioniert auch ohne Gesang besser?", theme: "wettkampf", tone: "family" },

    // ---- Gefühl -----------------------------------------
    { id: "du_troesten", text: "Welcher Song tröstet besser?", theme: "gefuehl", tone: "deep" },
    { id: "du_mut_machen", text: "Welcher Song macht mehr Mut?", theme: "gefuehl", tone: "deep" },
    { id: "du_beruhigen", text: "Welcher Song beruhigt schneller?", theme: "gefuehl", tone: "family" },
    { id: "du_wach_machen", text: "Welcher Song macht morgens eher wach?", theme: "gefuehl", tone: "family" },
    { id: "du_heimweh", text: "Welcher Song klingt mehr nach Zuhause?", theme: "gefuehl", tone: "family" },
    { id: "du_sehnsucht", text: "In welchem Song steckt mehr Sehnsucht?", theme: "gefuehl", tone: "deep" },
    { id: "du_wut_raus", text: "Bei welchem Song lässt sich Wut besser rauslassen?", theme: "gefuehl", tone: "family" },
    { id: "du_verliebt", text: "Welcher Song klingt mehr nach verliebt sein?", theme: "gefuehl", tone: "family" },
    { id: "du_einsam", text: "Welcher Song klingt einsamer?", theme: "gefuehl", tone: "deep" },
    { id: "du_leichtigkeit", text: "Welcher Song fühlt sich leichter an?", theme: "gefuehl", tone: "family" },

    // ---- Charakterurteil --------------------------------
    { id: "du_immer_zu_spaet", text: "Welchen Song hört eher jemand, der grundsätzlich zu spät kommt?", theme: "urteil", tone: "family" },
    { id: "du_socken_sortiert", text: "Welchen Song hört eher jemand, der Socken nach Farbe sortiert?", theme: "urteil", tone: "family" },
    { id: "du_kofferraum_chaos", text: "Welcher Song passt besser zu einem Auto voller alter Pfandflaschen?", theme: "urteil", tone: "family" },
    { id: "du_erste_reihe", text: "Welchen Song hört eher jemand, der sich im Kino immer nach vorn setzt?", theme: "urteil", tone: "family" },
    { id: "du_frueh_aufsteher", text: "Welcher Song passt eher zu jemandem, der freiwillig um sechs aufsteht?", theme: "urteil", tone: "family" },
    { id: "du_lehrer", text: "Welchen Song würde eher ein Lehrer in der Freistunde auflegen?", theme: "urteil", tone: "family" },
    { id: "du_oma", text: "Welcher Song würde Oma eher gefallen?", theme: "urteil", tone: "family" },
    { id: "du_kind_sieben", text: "Welchen Song würde ein Siebenjähriger sofort mögen?", theme: "urteil", tone: "family" },
    { id: "du_hund", text: "Bei welchem Song würde ein Hund eher mitwippen?", theme: "urteil", tone: "family" },
    { id: "du_katze", text: "Welchen Song würde eine Katze demonstrativer ignorieren?", theme: "urteil", tone: "family" },
    { id: "du_chef", text: "Welchen Song würdest du eher in der Playlist deiner Chefin vermuten?", theme: "urteil", tone: "spicy" },
    { id: "du_schwiegereltern", text: "Welchen Song würdest du eher beim ersten Besuch bei den Schwiegereltern riskieren?", theme: "urteil", tone: "spicy" },

    // ---- Szenario ---------------------------------------
    { id: "du_letzter_song_party", text: "Welcher Song ist der bessere letzte Song des Abends?", theme: "szenario", tone: "family" },
    { id: "du_party_retten", text: "Welcher Song rettet eine kippende Party eher?", theme: "szenario", tone: "family" },
    { id: "du_lagerfeuer", text: "Welcher Song passt besser ans Lagerfeuer?", theme: "szenario", tone: "family" },
    { id: "du_eroeffnungstanz", text: "Welcher Song funktioniert besser als Eröffnungstanz?", theme: "szenario", tone: "family" },
    { id: "du_roadtrip", text: "Welcher Song gehört eher zu offenen Fenstern und Landstraße?", theme: "szenario", tone: "family" },
    { id: "du_faehre", text: "Welcher Song passt besser an Deck einer Fähre bei Wind?", theme: "szenario", tone: "family" },
    { id: "du_schulaula", text: "Welcher Song wäre in einer Schulaula peinlicher?", theme: "szenario", tone: "spicy" },
    { id: "du_fahrstuhl", text: "Welcher Song wäre im Aufzug erträglicher, wenn er stecken bleibt?", theme: "szenario", tone: "family" },
    { id: "du_stadionhymne", text: "Welcher Song funktioniert besser als Stadionhymne?", theme: "szenario", tone: "family" },
    { id: "du_wahlkampf", text: "Welcher Song wäre die bessere Wahlkampfhymne?", theme: "szenario", tone: "family" },
    { id: "du_raketenstart", text: "Welcher Song passt besser zu einem Raketenstart?", theme: "szenario", tone: "family" },
    { id: "du_letzte_meter", text: "Welcher Song passt besser zu den letzten hundert Metern eines Laufs?", theme: "szenario", tone: "family" },
    { id: "du_werbung_auto", text: "Welcher Song verkauft ein Auto besser?", theme: "szenario", tone: "family" },
    { id: "du_werbung_schokolade", text: "Welcher Song verkauft eher Schokolade?", theme: "szenario", tone: "family" },
    { id: "du_kaffeewerbung", text: "Welcher Song passt besser in eine Kaffeewerbung um sechs Uhr morgens?", theme: "szenario", tone: "family" },

    // ---- Absurd (sparsam, dafür pointierter) ------------
    { id: "du_gans", text: "Welcher Song passt besser dazu, vor einer wütenden Gans wegzurennen?", theme: "absurd", tone: "family" },
    { id: "du_pinguin_marsch", text: "Welcher Song passt besser zu hundert Pinguinen, die zielstrebig irgendwohin laufen?", theme: "absurd", tone: "family" },
    { id: "du_kartoffelernte", text: "Welcher Song passt besser zur Kartoffelernte?", theme: "absurd", tone: "family" },
    { id: "du_saugroboter", text: "Welcher Song passt besser zu einem Saugroboter, der sich festgefahren hat?", theme: "absurd", tone: "family" },
    { id: "du_tauben", text: "Welcher Song läuft eher bei einer Versammlung sehr entschlossener Tauben?", theme: "absurd", tone: "family" },
    { id: "du_ente_gericht", text: "Welcher Song passt besser zu einer Ente, die vor Gericht steht?", theme: "absurd", tone: "family" },
    { id: "du_drachen_therapie", text: "Welcher Song läuft eher in der Gruppentherapie für Drachen?", theme: "absurd", tone: "family" },
    { id: "du_kuh_hymne", text: "Welcher Song wäre die bessere Nationalhymne eines Landes aus Kühen?", theme: "absurd", tone: "family" },
    { id: "du_zeitreise_schief", text: "Welcher Song passt besser zu einer Zeitreise, die komplett schiefgeht?", theme: "absurd", tone: "family" },
    { id: "du_roboter_trennung", text: "Welcher Song passt besser zu zwei Robotern, die sich trennen?", theme: "absurd", tone: "family" },
    { id: "du_moewe_pommes", text: "Welcher Song passt besser zu einer Möwe, die dir die Pommes klaut?", theme: "absurd", tone: "family" },
    { id: "du_schaf_flucht", text: "Welcher Song passt besser zu einem Schaf auf der Flucht?", theme: "absurd", tone: "family" },

    // ---- Zeit & Epoche ----------------------------------
    { id: "du_besser_gealtert", text: "Welcher Song ist besser gealtert?", theme: "zeit", tone: "family" },
    { id: "du_in_zehn_jahren", text: "Welcher Song läuft in zehn Jahren noch?", theme: "zeit", tone: "family" },
    { id: "du_klingt_aelter", text: "Welcher Song klingt älter, als er ist?", theme: "zeit", tone: "family" },
    { id: "du_1985", text: "Welcher Song hätte 1985 besser funktioniert?", theme: "zeit", tone: "family" },
    { id: "du_klingelton_2005", text: "Welcher Song wäre 2005 der bessere Klingelton gewesen?", theme: "zeit", tone: "family" },
    { id: "du_2100", text: "Welcher Song wird im Jahr 2100 noch verstanden?", theme: "zeit", tone: "family" },
    { id: "du_mittelaltermarkt", text: "Welcher Song würde auf einem Mittelaltermarkt weniger auffallen?", theme: "zeit", tone: "family" },
    { id: "du_vinyl", text: "Welcher Song gehört eher auf Vinyl?", theme: "zeit", tone: "family" },

    // ---- Frech ------------------------------------------
    { id: "du_dreister", text: "Welcher Song ist dreister?", theme: "urteil", tone: "spicy" },
    { id: "du_selbstbewusster", text: "Welcher Song ist selbstbewusster?", theme: "urteil", tone: "spicy" },
    { id: "du_peinlicher_bahn", text: "Welcher Song wäre peinlicher, wenn er in der Bahn aus deinen Kopfhörern dringt?", theme: "urteil", tone: "spicy" },
    { id: "du_ex_schicken", text: "Welchen Song würdest du eher einem Ex schicken?", theme: "urteil", tone: "spicy" },
    { id: "du_date_abbruch", text: "Bei welchem Song würdest du eher ein Date früher beenden?", theme: "urteil", tone: "spicy" },
    { id: "du_nachbarn", text: "Mit welchem Song würdest du deine Nachbarn schneller in den Wahnsinn treiben?", theme: "urteil", tone: "spicy" },
    { id: "du_ueberbewerteter", text: "Welcher Song ist überbewerteter?", theme: "urteil", tone: "spicy" },
    { id: "du_zu_lang", text: "Welcher Song ist eine Minute zu lang?", theme: "urteil", tone: "spicy" }
  ]
};
