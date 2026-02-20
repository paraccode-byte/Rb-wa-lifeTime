import { JSONFilePreset } from 'lowdb/node'

export default async function add(name, jid, url) {
    try {
        const db = await JSONFilePreset('./no_link.json', {});
        const db_default = await JSONFilePreset('./data-default.json', {});
        const allkeys = Object.keys(db.data);
        const lastKey = allkeys.length > 0 ? Math.max(...allkeys.map(Number)) : -1;
        const nextKey = (lastKey + 1).toString();
        db.data[nextKey] = db_default.data.data;
        await db.write();
        const db_grup = await JSONFilePreset('./data-group.json', { jid: {}, banner: {}, name: {} });
        db_grup.data.jid[nextKey] = jid.trim();
        db_grup.data.banner[nextKey] = url.trim();
        db_grup.data.name[nextKey] = name.trim(); 
        await db_grup.write();
        const set_welcome = await JSONFilePreset('./welcome.json', {});
        set_welcome.data[nextKey] = "Halo bro!";
        set_welcome.write()
        const set_leave = await JSONFilePreset('./leave.json', {})
        set_leave.data[nextKey] = "Bye bro!"
        set_leave.write()
        return true; 
    } catch (error) {
        console.error('Error in add_data.js:', error);
        throw error; 
    }
}