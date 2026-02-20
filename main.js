import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import fs from 'fs'
import sharp from 'sharp';
import { JSONFilePreset } from 'lowdb/node'
import { verify, url_banner, nameBot } from './verif.js';
import menu from './menu.js'
import add from './add_data.js'

async function start_bot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        defaultQueryTimeoutMs: undefined,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log('Koneksi terputus. Status:', statusCode, 'Mencoba lagi:', shouldReconnect);

            if (shouldReconnect) {
                start_bot();
            }
        } else if (connection === 'open') {
            console.log('✅ Bot sudah terhubung ke WhatsApp!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
    const messageHistory = {};
    sock.ev.on('messages.upsert', async m => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];

        const remoteJid = msg.key.remoteJid;
        const text = msg.message.conversation ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            msg.message.extendedTextMessage?.text ||
            "";

        if (remoteJid === '104105779396783@lid') {
            if (text.startsWith('.getinfo')) {
                console.log(`menerima perintah ✅`)
                try {
                    const link = text.replace('.getinfo', '').trim();
                    if (!link) return await sock.sendMessage(remoteJid, { text: 'masukan link!' })
                    const match = link.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]{20,26})/);
                    const code = match ? match[1] : null;
                    if (!code) {
                        throw new Error("Link invite tidak valid!");
                    }
                    const grupinfo = await sock.groupGetInviteInfo(code);
                    console.log(grupinfo);
                    const format = `*--- Informasi Grup Ditemukan ---*\n\n` +
                        `JID Grup  : ${grupinfo.id}\n` +
                        `Nama      : ${grupinfo.subject}\n` +
                        `Pembuat   : ${grupinfo.owner}\n` +
                        `Deskripsi : ${grupinfo.desc}`
                    await sock.sendMessage(remoteJid, {
                        text: format
                    }, { quoted: msg })
                } catch (error) {
                    console.error(error)
                    await sock.sendMessage(remoteJid, {
                        text: 'Nomor bot tidak ada dalam group'
                    }, { quoted: msg })
                }
            }
            if (text.startsWith('.add-data')) {
                const data_array = text.split('|');
                if (data_array.length < 4) {
                    return await sock.sendMessage(remoteJid, {
                        text: 'Format salah! Gunakan: .add-data|nama|jid|url_banner'
                    }, { quoted: msg });
                }
                try {
                    console.log('Menambahkan data...');
                    const name = data_array[1].trim();
                    const jid = data_array[2].trim();
                    const url = data_array[3].trim();
                    await add(name, jid, url);
                    await sock.sendMessage(remoteJid, {
                        text: `Data berhasil ditambahkan! ✅\n\nID: ${name}\nJID: ${jid}`
                    }, { quoted: msg });
                } catch (error) {
                    await sock.sendMessage(remoteJid, { text: 'Terjadi kesalahan sistem saat menambah data. ❌' }, { quoted: msg });
                    console.error(error);
                }
            }
        }

        const grupIndex = await verify(remoteJid);
        if (grupIndex === false) return

        const msgType = Object.keys(msg.message)[0];
        if (!msg.message) return;
        const isGroup = remoteJid.endsWith('@g.us');
        const groupMetadata = await sock.groupMetadata(remoteJid);
        const sender = msg.key.participantAlt || msg.key.remoteJid;
        const participant = groupMetadata.participants.find(p => p.phoneNumber === sender);
        const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';

        const no_link_json = JSON.parse(fs.readFileSync('./no_link.json', "utf-8"));
        for (let key in no_link_json[grupIndex]) {
            const filter = no_link_json[grupIndex][key];
            if (filter.condition === 'on' && text.includes(filter.link)) {
                console.log(`Link terlarang (${key}) ditemukan`);
                await sock.sendMessage(remoteJid, { delete: msg.key });
                await sock.sendMessage(remoteJid, {
                    text: "⚠️ Pesan otomatis dihapus karena mengandung link terlarang."
                });
                break;
            }
        }

        const toxic = await JSONFilePreset('./toxic.json', {})
        const toxic_word = ['anjing', 'babi', 'asu', 'bangsat', 'tolol', 'goblok', 'memek', 'peler', 'ngentot', 'ajg', 'mmk', 'gblk'];
        const find_teks = toxic_word.some(w => text.toLowerCase().includes(w));
        if (toxic.data[grupIndex] === 'on' && find_teks) {
            await sock.sendMessage(remoteJid, { delete: msg.key });
            await sock.sendMessage(remoteJid, { text: "⚠️ Pesan dihapus: Toxic terdeteksi." });
        }

        const spam = await JSONFilePreset('./spam.json', {})
        const now = Date.now();
        if (!messageHistory[sender]) {
            messageHistory[sender] = [];
        }
        messageHistory[sender].push(now);
        messageHistory[sender] = messageHistory[sender].filter(timestamp => now - timestamp < 10000);
        if (spam.data[grupIndex] === 'on' && messageHistory[sender].length > 4) {
            console.log(`Spam terdeteksi dari: ${sender}`);
            await sock.sendMessage(remoteJid, {
                text: `@${sender.split('@')[0]} Terdeteksi spam! Jangan flooding grup.`,
                mentions: [sender]
            });
            await sock.sendMessage(remoteJid, { delete: msg.key });
            messageHistory[sender] = [];
        }

        if (!isGroup || !isAdmin) return;
        const args = text.trim().split(/ +/);
        const fullCommand = args[0].toLowerCase();
        if (text === '.menu') {
            console.log(text)
            try {
                const url = await url_banner(grupIndex);
                const botname = await nameBot(grupIndex);
                await sock.sendMessage(remoteJid, {
                    image: { url: url },
                    caption: menu(botname)
                }, { quoted: msg }
                );
            } catch (err) {
                console.error('Gagal membaca file:', err.message);
                await sock.sendMessage(remoteJid, { text: 'Maaf, menu sedang tidak tersedia.' });
            }
        }
        if (fullCommand.startsWith('.nolink')) {
            console.log(text);
            const command = fullCommand.replace('.nolink', '');
            const on_of = args[1]?.toLowerCase();
            if (no_link_json[grupIndex][command]) {
                console.log(text);
                try {
                    if (!on_of || (on_of !== 'on' && on_of !== 'off')) {
                        return await sock.sendMessage(remoteJid, {
                            text: `Format salah! Gunakan: .nolink${command} on/off`
                        }, { quoted: msg });
                    }
                    const currentCondition = no_link_json[grupIndex][command].condition;
                    if (currentCondition !== on_of) {
                        no_link_json[grupIndex][command].condition = on_of;
                        fs.writeFileSync('./no_link.json', JSON.stringify(no_link_json, null, 4));
                        return await sock.sendMessage(remoteJid, {
                            text: `Pengaturan *${command}* telah diubah menjadi *${on_of}* ✅.`
                        });
                    } else {
                        return await sock.sendMessage(remoteJid, {
                            text: `Pengaturan *${command}* memang sudah *${on_of}*.`
                        });
                    }
                } catch (err) {
                    console.error(err);
                }
            }
        }

        if (text.startsWith('.mute')) {
            console.log(text);
            const on_of = text.replace('.mute', '').trim().toLowerCase();
            try {
                if (on_of !== 'on' && on_of !== 'off') return await sock.sendMessage(remoteJid, {
                    text: 'Format salah! contoh .mute on'
                }, { quoted: msg })
                if (on_of === 'on') {
                    await sock.groupSettingUpdate(remoteJid, 'announcement');
                    await sock.sendMessage(remoteJid, {
                        text: `Pengaturan mute telah di ubah menjadi ${on_of}.`
                    })
                } else {
                    await sock.groupSettingUpdate(remoteJid, 'not_announcement');
                    await sock.sendMessage(remoteJid, {
                        text: `Pengaturan mute telah di ubah menjadi ${on_of}.`
                    })
                }
            } catch (error) {
                console.error("Gagal mengubah izin grup:", error);
                await sock.sendMessage(remoteJid, { text: 'Gagal mengubah pengaturan. Pastikan bot adalah Admin!' });
            }
        }

        if (text.startsWith('.setwelcome')) {
            console.log(text);
            const isitext = text.replace('.setwelcome', '').trim();
            if (!isitext) return await sock.sendMessage(remoteJid, { text: 'Set pesan yang akan di kirim! contoh: .setwelcome selamat datang di grop kami!, sebutkan namamu' })
            try {
                const set_welcome = await JSONFilePreset('./welcome.json', {});
                set_welcome.data[grupIndex] = isitext;
                set_welcome.write();
                await sock.sendMessage(remoteJid, {
                    text: '✅ Pesan welcome berhasil diperbarui!'
                }, { quoted: msg });
            } catch (err) {
                console.error(err);
                await sock.sendMessage(remoteJid, { text: 'Gagal menyimpan file.' });
            }
        }
        if (text.startsWith('.setleave')) {
            console.log(text);
            const isitext = text.replace('.setleave', '').trim();
            if (!isitext) return await sock.sendMessage(remoteJid, { text: 'Set pesan yang akan di kirim! contoh: .setleave selamat tinggal dari grop kami 👋' })
            try {
                const set_leave = await JSONFilePreset('./leave.json', {})
                set_leave.data[grupIndex] = isitext;
                set_leave.write();
                await sock.sendMessage(remoteJid, {
                    text: '✅ Pesan leave berhasil diperbarui!'
                }, { quoted: msg });
            } catch (err) {
                console.error(err);
                await sock.sendMessage(remoteJid, { text: 'Gagal menyimpan file.' });
            }
        }
        if (text.startsWith('.notoxic')) {
            console.log(text);
            if (!isAdmin) return await sock.sendMessage(remoteJid, { text: 'Khusus Admin!' });
            const on_of = text.replace('.notoxic', '').trim().toLowerCase();
            if (on_of !== 'on' && on_of !== 'off') {
                return await sock.sendMessage(remoteJid, { text: 'Format salah! contoh .notoxic on' });
            }
            if (on_of === 'on') {
                toxic.data[grupIndex] = 'on'
                toxic.write()
                return await sock.sendMessage(remoteJid, { text: `Fitur notoxic berhasil diubah ke ${on_of}` });
            } else {
                toxic.data[grupIndex] = 'off'
                toxic.write()
                return await sock.sendMessage(remoteJid, { text: `Fitur notoxic berhasil diubah ke ${on_of}` });
            }
        }
        if (text.startsWith('.nospam')) {
            console.log(text);
            if (!isAdmin) return await sock.sendMessage(remoteJid, { text: 'Khusus Admin!' });
            const on_of = text.replace('.nospam', '').trim().toLowerCase();
            if (on_of !== 'on' && on_of !== 'off') {
                return await sock.sendMessage(remoteJid, { text: 'Format salah! contoh .nospam on' });
            }
            if (on_of === 'on') {
                spam.data[grupIndex] = 'on'
                spam.write()
                return await sock.sendMessage(remoteJid, { text: `Fitur nospam berhasil diubah ke ${on_of}` });
            } else {
                spam.data[grupIndex] = 'off'
                spam.write()
                return await sock.sendMessage(remoteJid, { text: `Fitur nospam berhasil diubah ke ${on_of}` });
            }
        }
        if (text.startsWith('.setnamegroup')) {
            console.log(text);
            try {
                const nama = text.replace('.setnamegroup', '').trim().toLocaleLowerCase();
                if (!nama) return await sock.sendMessage(remoteJid, {
                    text: 'Ketik nama grup yang di ingin kan! contoh: .setnamegroup JB oki store'
                })
                await sock.groupUpdateSubject(remoteJid, nama);
                await sock.sendMessage(remoteJid, {
                    text: 'Nama grup berhasil di ubah ✅'
                })
            } catch (error) {
                console.error(error)
            }
        }
        if (text.startsWith('.setdescgroup') || text.startsWith('.editinfo')) {
            console.log(text);
            try {
                const desc = text.replace('.setdescgrpup', '').trim().toLocaleLowerCase();
                if (!desc) return await sock.sendMessage(remoteJid, {
                    text: 'Ketik isi deskripsi yang di ingin kan! contoh: .setdescgrpup jangan toxic ya guys'
                })
                await sock.groupUpdateDescription(remoteJid, desc);
                await sock.sendMessage(remoteJid, {
                    text: 'Descripsi grup berhasil di ubah ✅'
                })
            } catch (error) {
                console.error(error)
            }
        }
        if (text === '.setppgroup') {
            console.log(text);
            try {
                const isImage = msgType === 'imageMessage';
                const isQuotedImage = msgType === 'extendedTextMessage' && msg.message.extendedTextMessage.contextInfo?.quotedMessage?.imageMessage;
                if (!isImage && !isQuotedImage) {
                    return await sock.sendMessage(remoteJid, { text: 'Kirim gambar dengan caption .img2stiker atau balas gambar dengan .img2stiker' });
                }
                const messageToDownload = isQuotedImage ? {
                    message: msg.message.extendedTextMessage.contextInfo.quotedMessage
                } : msg;
                const buffer = await downloadMediaMessage(
                    messageToDownload,
                    'buffer',
                    {},
                    {
                        reuploadRequest: sock.updateMediaMessage
                    }
                );
                const pp = await sharp(buffer)
                    .resize(512, 512, {
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 }
                    })
                    .webp()
                    .toBuffer();
                await sock.updateProfilePicture(remoteJid, pp)
                await sock.sendMessage(remoteJid, {
                    text: 'Profile picture grup berhasil di ubah ✅'
                })
            } catch (error) {
                console.error(error)
            }
        }
        if (text === '.delppgroup') {
            console.log(text);
            try {
                await sock.removeProfilePicture(remoteJid)
                await sock.sendMessage(remoteJid, {
                    text: 'Profile picture grup berhasil di hapus ✅'
                })
            } catch (error) {
                console.error(error)
            }
        }
        if (text.startsWith('.add')) {
            console.log(text);
            try {
                const nomor = text.replace('.add', '').trim().toLocaleLowerCase();
                if (!nomor || !(/^08\d{8,11}$/.test(nomor))) return await sock.sendMessage(remoteJid, {
                    text: 'Ketik nomor yang ingin di masukan! contoh: .add 0812399999'
                })
                const format_nomor = [`${nomor.replace('0', '62')}@s.whatsapp.net`]
                await sock.groupParticipantsUpdate(remoteJid, format_nomor, "add");
                await sock.sendMessage(remoteJid, {
                    text: 'Anggota baru berhasil di tambahkan ✅'
                })
            } catch (error) {
                console.error(error)
            }
        }
        if (text.startsWith('.kick')) {
            console.log(text);
            try {
                const nomor = text.replace('.kick', '').trim().toLocaleLowerCase();
                if (!nomor || !(/^08\d{8,11}$/.test(nomor))) return await sock.sendMessage(remoteJid, {
                    text: 'Ketik nomor yang ingin di keluarkan! contoh: .kick 0812399999'
                })
                const format_nomor = [`${nomor.replace('0', '62')}@s.whatsapp.net`]
                await sock.groupParticipantsUpdate(remoteJid, format_nomor, "remove");
                await sock.sendMessage(remoteJid, {
                    text: 'Anggota berhasil di keluarkan ✅'
                })
            } catch (error) {
                console.error(error)
            }
        }
        if (text.startsWith('.createadmin')) {
            console.log(text);
            try {
                const nomor = text.replace('.createadmin', '').trim().toLocaleLowerCase();
                if (!nomor || !(/^08\d{8,11}$/.test(nomor))) return await sock.sendMessage(remoteJid, {
                    text: 'Ketik nomor yang ingin di tambahkan menjadi admin! contoh: .createadmin 0812399999'
                })
                const format_nomor = [`${nomor.replace('0', '62')}@s.whatsapp.net`]
                await sock.groupParticipantsUpdate(remoteJid, format_nomor, "promote");
                await sock.sendMessage(remoteJid, {
                    text: 'Admin baru berhasil di tambahkan ✅'
                })
            } catch (error) {
                console.error(error)
            }
        }
        if (text.startsWith('.cabutadmin')) {
            console.log(text);
            try {
                const nomor = text.replace('.cabutadmin', '').trim().toLocaleLowerCase();
                if (!nomor || !(/^08\d{8,11}$/.test(nomor))) return await sock.sendMessage(remoteJid, {
                    text: 'Ketik nomor yang ingin di cabut menjadi admin! contoh: .cabutadmin 0812399999'
                })
                const format_nomor = [`${nomor.replace('0', '62')}@s.whatsapp.net`]
                await sock.groupParticipantsUpdate(remoteJid, format_nomor, "demote");
                await sock.sendMessage(remoteJid, {
                    text: 'Admin berhasil di cabut ✅'
                })
            } catch (error) {
                console.error(error)
            }
        }
        if (text === '.listadmin') {
            console.log(text)
            try {
                const groupMetadata = await sock.groupMetadata(remoteJid);
                const participants = groupMetadata.participants;
                const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
                let teks = `*DAFTAR ADMIN GRUP*\n\n`;
                const adminMentions = [];
                admins.forEach((admin, i) => {
                    teks += `${i + 1}. @${admin.id.split('@')[0]}\n`;
                    adminMentions.push(admin.id);
                });
                teks += `\nTotal: ${admins.length} Admin`;
                await sock.sendMessage(remoteJid, {
                    text: teks,
                    mentions: adminMentions
                }, { quoted: msg });

            } catch (err) {
                console.error('Gagal mengambil daftar admin:', err.message);
                await sock.sendMessage(remoteJid, { text: 'Terjadi kesalahan saat mengambil data admin.' });
            }
        }
    });
    sock.ev.on('group-participants.update', async (update) => {
        const jid = update.id;
        const grupIndex = await verify(jid);

        if (update.action === 'add') {
            const mentions = update.participants.map(p => p.phoneNumber || p.id);
            const teks = await JSONFilePreset('./welcome.json', {})
            await sock.sendMessage(jid, {
                text: teks.data[grupIndex],
                mentions: mentions
            });
        }
        if (update.action === 'remove') {
            const mentions = update.participants.map(p => p.phoneNumber || p.id);
            const teks = await JSONFilePreset('./leave.json', {});
            await sock.sendMessage(jid, {
                text: teks.data[grupIndex],
                mentions: mentions
            });
        }
    })
}

start_bot();