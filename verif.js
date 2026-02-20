import { JSONFilePreset } from 'lowdb/node'

export async function verify(jid) {
    const db = await JSONFilePreset('./data-group.json', { posts: [] })
    const array_jid = Object.values(db.data.jid)
    const index = array_jid.indexOf(jid);
    return index !== -1 ? index : false;
}
export async function url_banner(grupIndex) {
    const obj_url = await JSONFilePreset('./data-group.json', { posts: [] })
    return obj_url.data.banner[grupIndex];
}

export async function nameBot(grupIndex) {
    const obj_name = await JSONFilePreset('./data-group.json', { posts: [] })
    return obj_name.data.name[grupIndex];
}