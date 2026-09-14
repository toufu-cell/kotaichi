export async function authorized(request: Request, password?: string) {
    if (!password || password.length < 16) return false;
    const authorization = request.headers.get('Authorization') ?? '';
    if (authorization.length > 512) return false;
    const encoder = new TextEncoder();
    const [provided, expected] = await Promise.all([authorization, `Bearer ${password}`].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
    const expectedBytes = new Uint8Array(expected);
    let difference = 0;
    new Uint8Array(provided).forEach((value, i) => { difference |= value ^ expectedBytes[i]; });
    return difference === 0;
}
