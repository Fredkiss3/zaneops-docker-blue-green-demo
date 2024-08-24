import type { APIRoute } from "astro";

export const GET: APIRoute = ({ request, params }) => {
    const sp = new URL(request.url).searchParams;
    return fetch(
        `http://127.0.0.1:8000/api/projects/sandbox/service-details/docker/${
            params.service_slug
        }/deployments/${params.deployment_hash}/logs?${sp.toString()}`,
        {
            credentials: "include",
            headers: {
                Cookie: "sessionid=joohth4b0vcx6h4zspotzq40rdi1u7ah;",
            },
        }
    );
};
