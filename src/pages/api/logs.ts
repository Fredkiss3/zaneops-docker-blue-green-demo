import type { APIRoute } from "astro";

export const GET: APIRoute = ({ request }) => {
    const sp = new URL(request.url).searchParams;
    return fetch(
        `http://127.0.0.1:8000/api/projects/sandbox/service-details/docker/nginx-demo/deployments/dpl_dkr_XUAnwUGZobM/logs?${sp.toString()}`,
        {
            credentials: "include",
            headers: {
                Cookie: "sessionid=yi19orh48z93y9iaxs4olsa048vo65ab;",
            },
        }
    );
};
