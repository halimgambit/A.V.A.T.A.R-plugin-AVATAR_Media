import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename)

let mediaWindow = null;

const resolvePath = (p) => p.replace(/%([^%]+)%/g, (_, env) => process.env[env] || '');

const getVideoDir = () => resolvePath(Config.modules.AVATAR_Media.VIDEO_DIR);
const getMusicDir = () => resolvePath(Config.modules.AVATAR_Media.MUSIC_DIR);
const getPlaylistDir = () => resolvePath(Config.modules.AVATAR_Media.PLAYLIST_DIR);

const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".avi", ".mov", ".m4v"];
const AUDIO_EXTENSIONS = [".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac", ".wma"];

export async function init() {
    await Avatar.lang.addPluginPak("AVATAR_Media");
}

export async function action(data, callback) {
    try {
        const client = data.client;
        const toClient = data.toClient || data.client;
        const Locale = await Avatar.lang.getPak("AVATAR_Media", data.language);

        const tblActions = {
            listenRadio: () => listenRadio(data, client, toClient, Locale),
            watchTv: () => watchTv(data, client, toClient, Locale),
            playMovie: () => playMovie(data, client, toClient, Locale),
            playMusic: () => playMusic(data, client, toClient, Locale),
            playPlaylist: () => playPlaylist(data, client, toClient, Locale),
            stopMedia: () => stopMedia(client, toClient, Locale)
        };

		info("AVATAR_Media:", data.action.command, "from", client, "to", toClient);
        
        if (tblActions[data.action?.command]) {
            await tblActions[data.action?.command]();
        }

    } catch (err) {
        if (data?.client) Avatar.Speech.end(data.client);
        if (err.message) error(err.message);
    } finally {
        if (typeof callback === "function") callback();
    }
}

const normalizeStr = (str = "") =>
    str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const openMediaWindow = async (mediaInfo) => {
    const payload = JSON.stringify(mediaInfo);

    if (mediaWindow && !mediaWindow.isDestroyed()) {
        mediaWindow.show();
        mediaWindow.focus();
        await mediaWindow.webContents.executeJavaScript(`
            if (typeof window.playMedia === "function") window.playMedia(${payload});
        `);
        return;
    }

    const mainWin = Avatar.Interface.mainWindow();
    if (mainWin?.isMinimized()) mainWin.restore();
    mainWin?.focus();

    mediaWindow = await Avatar.Interface.BrowserWindow({
        parent: mainWin,
        center: true,
        frame: true,
        movable: true,
        resizable: true,
        minimizable: false,
        alwaysOnTop: true,
        show: true,
        width: 1990,
        height: 1250,
        title: "AVATAR MediaPlayer"
    }, path.resolve(__dirname, "AVATAR_Media.html"), false);

    mediaWindow.webContents.on("did-fail-load", (errorCode, errorDescription) => {
        error(`MediaPlayer load error : ${errorCode} - ${errorDescription}`);
    });

    mediaWindow.webContents.on("did-finish-load", async () => {
        info("MediaPlayer HTML chargé");

        await mediaWindow.webContents.executeJavaScript(`
            if (typeof window.playMedia === "function") window.playMedia(${payload});
        `);
    });

    mediaWindow.on("closed", () => {
        mediaWindow = null;
    });
};

const listenRadio = async (data, client, toClient, Locale) => {
    if (data.mediaData) {
        await openMediaWindow(data.mediaData);
        return;
    }

    const sentence = normalizeStr(data.rawSentence || data.sentence || data.action.sentence);
    const radios = Config.modules.AVATAR_Media.radios;

    const key = Object.keys(radios)
        .sort((a, b) => b.length - a.length)
        .find(k => sentence.includes(normalizeStr(k)));

    if (!key) {
        return askUnknownRadio(data, client, toClient, Locale);
    }

    const radio = radios[key];
    info(`AVATAR_Media Radio : ${key} → ${radio.url}`);
    const mediaInfo = { type: "radio", name: key, url: radio.url, logo: radio.logo || "" };

    Avatar.speak(Locale.get(["speech.playRadio", key]), client, async () => {
    info(Locale.get(["speech.playRadio", key]));
    if (typeof Avatar.clientPlugin === "function" && toClient) {
        Avatar.clientPlugin(toClient, "AVATAR_Media", {
            ...data,
            client: toClient,
            toClient: toClient,
            mediaData: mediaInfo
        }, () => {});
    } else {
        await openMediaWindow(mediaInfo);
    }
    Avatar.Speech.end(client);
});

};

const askUnknownRadio = (data, client, toClient, Locale, callback) => {
    info(Locale.get("speech.whichRadio"));
    Avatar.askme(Locale.get("speech.whichRadio"), client, {
        "*": "generic",
        "annule": "cancel",
        "annuler": "cancel",
        "terminé": "cancel",
        "terminer": "cancel"
    }, 15, async (answer, end) => {

        info(answer);

        if (answer && answer.split(":")[1]) {
            end(client);
            const newRadioName = answer.split(":")[1].trim();
            data.rawSentence = newRadioName;
            data.sentence = newRadioName;
            return listenRadio(data, client, toClient, Locale);
        }

        switch (answer) {
            case "cancel":
                end(client);
                info(Locale.get("speech.cancel"));
                Avatar.speak(Locale.get("speech.cancel"), client, () => {
                    if (callback) callback();
                });
                break;

            default:
                end(client);
                info(Locale.get("speech.Timeout"));
                Avatar.speak(Locale.get("speech.Timeout"), client, () => {
                    if (callback) callback();
                });
                break;
        }
    });
};


const loadChannels = async () => {
    const jsonPath = path.resolve(__dirname, "channels.json");
    try {
        const raw = await fs.readFile(jsonPath, "utf8");
        return JSON.parse(raw);
    } catch {
        return Config.modules.AVATAR_Media?.channels || {};
    }
};

const watchTv = async (data, client, toClient, Locale) => {
    if (data.mediaData) {
        await openMediaWindow(data.mediaData);
        return;
    }

    const sentence = normalizeStr(data.rawSentence || data.action?.sentence);
    const channels = await loadChannels();

    const key = Object.keys(channels)
        .sort((a, b) => b.length - a.length)
        .find(k => sentence.includes(normalizeStr(k)));

    if (!key) {
        info(Locale.get("speech.unknowChannel"));
        return Avatar.speak(Locale.get("speech.unknowChannel"), client, () => Avatar.Speech.end(client));
    }

    const url = channels[key];
    info(`AVATAR_Media TV : ${key} → ${url}`);
    const mediaInfo = { type: "tv", name: key, url: url, logo: "" };

    Avatar.speak(Locale.get(["speech.playTv", key]), client, async () => {
        info(Locale.get(["speech.playTv", key]));
    if (typeof Avatar.clientPlugin === "function" && toClient) {
        Avatar.clientPlugin(toClient, "AVATAR_Media", {
            ...data,
            client: toClient,
            toClient: toClient,
            mediaData: mediaInfo
        }, () => {});
    } else {
        await openMediaWindow(mediaInfo);
    }
        Avatar.Speech.end(client);
    });
    return;
};


// ============================================================
// RECHERCHE RÉCURSIVE DES VIDÉOS
// ============================================================
const getVideoFiles = async (dir) => {
    let results = [];
    try {
        const list = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of list) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                const subResults = await getVideoFiles(fullPath);
                results = results.concat(subResults);
            } else {
                const ext = path.extname(entry.name).toLowerCase();
                if (VIDEO_EXTENSIONS.includes(ext)) {
                    const cleanTitle = path.basename(entry.name, ext).replace(/^[0-9\s\-_]+/, "");
                    results.push({ name: entry.name, title: cleanTitle, path: fullPath });
                }
            }
        }
    } catch (err) {
        error(`AVATAR_Media: Erreur lecture répertoire vidéo [${dir}] : ${err.message}`);
    }
    return results;
};

// ============================================================
// PLAY MOVIE (FILMS & SÉRIES)
// ============================================================
const playMovie = async (data, client, toClient, Locale) => {

    if (data.mediaData) {
        await openMediaWindow(data.mediaData);
        return;
    }

    try {
        const videoDir = getVideoDir();
        const sentence = (data.rawSentence || data.action?.sentence || "").toLowerCase();
        const cleanSentence = normalizeStr(sentence);

        const extract = {
            serie: data.action?.serie || null,
            saison: data.action?.saison || null,
            episode: data.action?.episode || null
        };

        if (!extract.serie) {
            const matchSaison = sentence.match(/saison\s+(\d+)/i);
            const matchEpisode = sentence.match(/(?:épisode|episode)\s+(\d+)/i);

            if (matchSaison) extract.saison = parseInt(matchSaison[1], 10);
            if (matchEpisode) extract.episode = parseInt(matchEpisode[1], 10);

            const matchSerie = sentence.match(/(?:série|serie)\s+(.*?)(?:\s+saison|\s+épisode|\s+episode|$)/i);
            if (matchSerie) extract.serie = matchSerie[1].trim();
        }

        const videoFiles = await getVideoFiles(videoDir);

        if (!videoFiles || videoFiles.length === 0) {
            info("AVATAR_Media: Aucun fichier vidéo trouvé dans", videoDir);
            return Avatar.speak(Locale.get(["speech.noVideosFound", videoDir]), client);
        }

        let foundMovie = null;

        if (extract.serie) {
            foundMovie = videoFiles
                .sort((a, b) => b.title.length - a.title.length)
                .find(video => {
                    const file = normalizeStr(video.path);
                    const fileName = path.basename(file);
                    const title = normalizeStr(video.title);
                    const serie = normalizeStr(extract.serie);

                    if (!file.includes(serie) && !title.includes(serie)) return;

                    if (extract.saison) {
                        const s = extract.saison;
                        const seasonRegex = new RegExp(`(?:saison\\s*0?${s}|s0?${s}[\\s\\._e\\]\\[\\-]|saison0?${s})`, "i");
                        if (!seasonRegex.test(file)) return false;
                    }

                    if (extract.episode) {
                        const ep = extract.episode;
                        const episodeRegex = new RegExp(`(?:ep(?:isode)?\\.?\\s*0?${ep}|e0?${ep}[\\s\\._\\-\\]]|épisode\\s*0?${ep})`, "i");
                        if (!episodeRegex.test(fileName)) return false;
                    }

                    return true;
                });
        } else {
            const stopWords = new Set(["le", "la", "les", "du", "de", "des", "et", "un", "une", "film", "mets", "lance", "joue", "regarder"]);
            let highestScore = 0;

            const sortedMovies = videoFiles.sort((a, b) => b.title.length - a.title.length);

            for (const video of sortedMovies) {
                const cleanTitle = normalizeStr(video.title);

                if (cleanSentence.includes(cleanTitle)) {
                    foundMovie = video;
                    break;
                }

                const titleWords = cleanTitle.split(" ").filter(w => w.length > 1 && !stopWords.has(w));
                if (titleWords.length === 0) continue;

                let matchedWords = 0;
                for (const word of titleWords) {
                    if (cleanSentence.includes(word)) matchedWords++;
                }

                const score = matchedWords / titleWords.length;
                if (score >= 0.5 && score > highestScore) {
                    highestScore = score;
                    foundMovie = video;
                }
            }
        }

        if (!foundMovie) {
            info("AVATAR_Media: Film ou Série non trouvé dans", videoDir);
            return Avatar.speak(Locale.get("speech.unknownMovie"), client);
        }

        Avatar.static.set(videoDir, async () => {
            const relativePath = path.relative(videoDir, foundMovie.path).replace(/\\/g, "/");
            const serverIp = Config.http.ip;
            const serverPort = Config.http.port;
            const videoUrl = `http://${serverIp}:${serverPort}/${encodeURIComponent(relativePath).replace(/%2F/g, "/")}`;

            info(`AVATAR_Media Film : ${foundMovie.title} → ${videoUrl}`);
            const mediaInfo = { type: "movie", name: foundMovie.title, url: videoUrl, logo: "" };

             Avatar.speak(Locale.get(["speech.playMovie", foundMovie.title]), client, async () => {
            info(Locale.get(["speech.playMovie", foundMovie.title]));
             if (typeof Avatar.clientPlugin === "function" && toClient) {
                Avatar.clientPlugin(toClient, "AVATAR_Media", {
                    ...data,
                    client: toClient,
                    toClient: toClient,
                    mediaData: mediaInfo
                }, () => {});
            } else {
                await openMediaWindow(mediaInfo);
            }
                Avatar.Speech.end(client);
            });
            return;
        });

    } catch (err) {
        error("Erreur AVATAR_Media playMovie:", err.message);
        return Avatar.speak(Locale.get("speech.errorApi"), client);
    }
};

// ============================================================
// RECHERCHE RÉCURSIVE DES MUSIQUES
// ============================================================
const getAudioFiles = async (dir) => {
    let results = [];
    try {
        const list = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of list) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results = results.concat(await getAudioFiles(fullPath));
            } else {
                const ext = path.extname(entry.name).toLowerCase();
                if (AUDIO_EXTENSIONS.includes(ext)) {
                    const cleanTitle = path.basename(entry.name, ext).replace(/^[0-9\s\-_.]+/, "");
                    results.push({ name: entry.name, title: cleanTitle, path: fullPath });
                }
            }
        }
    } catch (err) {
        error(`AVATAR_Media: Erreur lecture répertoire musique [${dir}] : ${err.message}`);
    }
    return results;
};

// ============================================================
// PLAY MUSIC (TITRE, ARTISTE/DOSSIER OU PLAYLIST .M3U)
// ============================================================
const playMusic = async (data, client, toClient, Locale) => {
    // 1. Exécution sur le client distant (Salon / Chambre)
    if (data.mediaData) {
        await openMediaWindow(data.mediaData);
        return;
    }

    try {
        const musicDir = getMusicDir();
        const playlistDir = getPlaylistDir();
        const sentence = (data.rawSentence || data.action?.sentence || "").toLowerCase();
        const cleanSentence = normalizeStr(sentence);

        info("phrase nettoyer", cleanSentence)

        const stopWords = new Set(["le", "la", "les", "du", "de", "des", "et",
        "un", "une", "musique", "l'artiste", "chanteur", "chanteuse", "groupe",
        "chanson", "l'album", "album", "mets", "lance", "joue", "je", "veux", "écouter"]);
        const keywords = cleanSentence.split(" ").filter(w => w.length > 1 && !stopWords.has(w));


        let tracksToPlay = [];
        let displayTitle = "Musique";

        if (playlistDir && keywords.length > 0) {
            try {
                const plFiles = await fs.readdir(playlistDir);
                const foundPl = plFiles.find(f => {
                    const ext = path.extname(f).toLowerCase();
                    if (ext !== ".m3u" && ext !== ".m3u8") return false;
                    const plName = normalizeStr(path.basename(f, ext));
                    return keywords.some(k => plName.includes(k));
                });

                if (foundPl) {
                    const content = await fs.readFile(path.join(playlistDir, foundPl), "utf-8");
                    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
                    displayTitle = `Playlist : ${path.basename(foundPl, path.extname(foundPl))}`;

                    for (const line of lines) {
                        const resolved = path.isAbsolute(line) ? line : path.resolve(playlistDir, line);
                        if (resolved.startsWith(musicDir)) {
                            const ext = path.extname(resolved);
                            tracksToPlay.push({
                                title: path.basename(resolved, ext).replace(/^[0-9\s\-_.]+/, ""),
                                path: resolved
                            });
                        }
                    }
                }
            } catch (e) {
            }
        }

        if (tracksToPlay.length === 0) {
            const allAudio = await getAudioFiles(musicDir);
            if (!allAudio || allAudio.length === 0) {
                Avatar.speak(Locale.get("speech.noMusicFound"), client);
                info(Locale.get("speech.noMusicFound"));
                return;
            }

            if (keywords.length === 0) {
                tracksToPlay = allAudio.sort(() => Math.random() - 0.5).slice(0, 50);
                displayTitle = "Mix Musical";
            } else {
                const matched = allAudio.filter(track => {
                    const relPath = normalizeStr(path.relative(musicDir, track.path));
                    return keywords.every(k => relPath.includes(k));
                });

                if (matched.length > 0) {
                    tracksToPlay = matched;
                    displayTitle = matched.length === 1 ? matched[0].title : keywords.join(" ").toUpperCase();
                }
            }
        }

        if (tracksToPlay.length === 0) {
            info(Locale.get("speech.unknownMusic"));
            return Avatar.speak(Locale.get("speech.unknownMusic"), client);
        }

        Avatar.static.set(musicDir, async () => {
            const serverIp = Config.http.ip;
            const serverPort = Config.http.port;

            const playlistUrls = tracksToPlay.map(t => {
                const rel = path.relative(musicDir, t.path).replace(/\\/g, "/");
                return {
                    title: t.title,
                    url: `http://${serverIp}:${serverPort}/${encodeURIComponent(rel).replace(/%2F/g, "/")}`
                };
            });

            info(`AVATAR_Media Musique : ${displayTitle} (${playlistUrls.length} titre(s))`);

            const mediaInfo = {
                type: "music",
                name: displayTitle,
                url: playlistUrls[0].url,
                playlist: playlistUrls,
                logo: ""
            };

            Avatar.speak(Locale.get(["speech.playMusic", displayTitle]), client, async () => {
                 info(Locale.get(["speech.playMusic", displayTitle]));
             if (typeof Avatar.clientPlugin === "function" && toClient) {
                Avatar.clientPlugin(toClient, "AVATAR_Media", {
                    ...data,
                    client: toClient,
                    toClient: toClient,
                    action: { command: "playMusic" },
                    mediaData: mediaInfo
                }, () => {});
            } else {
                await openMediaWindow(mediaInfo);
            }
                Avatar.Speech.end(client);
            });
            return;
        });

    } catch (err) {
        error("Erreur AVATAR_Media playMusic:", err.message);
        Avatar.speak(Locale.get("speech.errorApi"), client);
    }
};


// ============================================================
// PLAY PLAYLIST (LECTURE D'UNE PLAYLIST .M3U / .M3U8)
// ============================================================

const playPlaylist = async (data, client, toClient, Locale) => {
    // 1. Exécution sur le client distant (Salon / Chambre)
    if (data.mediaData) {
        await openMediaWindow(data.mediaData);
        return;
    }

    try {
        const musicDir = getMusicDir();
        const playlistDir = getPlaylistDir();
        const sentence = (data.rawSentence || data.action?.sentence || "").toLowerCase();
        const cleanSentence = normalizeStr(sentence);

        info("Phrase:", cleanSentence);

        const stopWords = new Set(["le", "la", "les", "du", "de", "des", "et", "un", "une", "ma",
        "playlist", "liste", "lecture", "mets", "lance", "joue", "ecoute", "ecouter"]);
        const keywords = cleanSentence.split(" ").filter(w => w.length > 1 && !stopWords.has(w));

        if (!playlistDir) {
            return Avatar.speak(Locale.get("speech.noPlaylistFound"), client);
        }

        const plFolders = (await fs.readdir(playlistDir, {
            withFileTypes: true
        })).filter(entry => entry.isDirectory());

        if (plFolders.length === 0) {
            info(Locale.get("speech.noPlaylistFound"));
            return Avatar.speak(Locale.get("speech.noPlaylistFound"), client);
        }

        let foundPl = null;
        if (keywords.length === 0) {
            foundPl = plFolders[Math.floor(Math.random() * plFolders.length)];
        } else {
            foundPl = plFolders.find(f => {
                const name = normalizeStr(f.name);
                return keywords.every(k => name.includes(k));
            }) || plFolders.find(f => {
                const name = normalizeStr(f.name);
                return keywords.some(k => name.includes(k));
            });
        }

        if (!foundPl) {
            info(Locale.get("speech.unknownPlaylist"));
            return Avatar.speak(Locale.get("speech.unknownPlaylist"), client);
        }

        const displayTitle = foundPl.name;
        const selectedFolder = path.join(playlistDir, foundPl.name);
        const tracksToPlay = await getAudioFiles(selectedFolder);

        if (tracksToPlay.length === 0) {
            info(Locale.get("speech.unknownPlaylist"));
            return Avatar.speak(Locale.get("speech.unknownPlaylist"), client);
        }

        tracksToPlay.sort((a, b) => a.title.localeCompare(b.title, "fr"));

        Avatar.static.set(musicDir, async () => {
            const serverIp = Config.http.ip;
            const serverPort = Config.http.port;

            const playlistUrls = tracksToPlay.map(t => {
                const rel = path.relative(musicDir, t.path).replace(/\\/g, "/");
                return {
                    title: t.title,
                    url: `http://${serverIp}:${serverPort}/${encodeURIComponent(rel).replace(/%2F/g, "/")}`
                };
            });

            info(`AVATAR_Media Playlist : ${displayTitle} (${playlistUrls.length} titre(s))`);

            const mediaInfo = {
                type: "music",
                name: `Playlist : ${displayTitle}`,
                url: playlistUrls[0].url,
                playlist: playlistUrls,
                logo: ""
            };

            const speechMsg = Locale.get(["speech.playPlaylist", displayTitle]);
            info(speechMsg);
            Avatar.speak(speechMsg, client, async () => {
            if (typeof Avatar.clientPlugin === "function" && toClient) {
                Avatar.clientPlugin(toClient, "AVATAR_Media", {
                    ...data,
                    client: toClient,
                    toClient: toClient,
                    action: { command: "playPlaylist" },
                    mediaData: mediaInfo
                }, () => {});
            } else {
                await openMediaWindow(mediaInfo);
            }
                Avatar.Speech.end(client);
            });
            return;
        });

    } catch (err) {
        error("Erreur AVATAR_Media playPlaylist:", err.stack || err.message);
        Avatar.speak(Locale.get("speech.errorApi"), client);
    }
};



const stopMedia = async (client, toClient, Locale) => {
    if (typeof Avatar.clientPlugin === "function" && toClient) {
        Avatar.clientPlugin(toClient, "AVATAR_Media", {
            client: toClient,
            toClient: toClient,
            action: { command: "stopMedia" }
        }, () => {});

        Avatar.speak(Locale.get("speech.stop"), client, () => {
			info(Locale.get("speech.stop"));
            Avatar.Speech.end(client);
        });
        return;
    }

    if (mediaWindow && !mediaWindow.isDestroyed()) {
        mediaWindow.close();
        mediaWindow = null;
    }
};
