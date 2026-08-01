const BASE = "/api";
async function request(path, opts = {}) {
    const { body, ...rest } = opts;
    const res = await fetch(`${BASE}${path}`, {
        ...rest,
        headers: {
            "Content-Type": "application/json",
            ...rest.headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new ApiError(res.status, text);
    }
    if (res.status === 204)
        return undefined;
    return res.json();
}
export class ApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = "ApiError";
    }
}
// Convenience wrappers
export const api = {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: "POST", body }),
    put: (path, body) => request(path, { method: "PUT", body }),
    patch: (path, body) => request(path, { method: "PATCH", body }),
    delete: (path) => request(path, { method: "DELETE" }),
    /** Upload a single file as multipart/form-data with field name "file". */
    upload: async (path, file) => {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api${path}`, { method: "POST", body: form });
        if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            throw new ApiError(res.status, text);
        }
        return res.json();
    },
};
