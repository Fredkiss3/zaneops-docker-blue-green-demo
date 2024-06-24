import type { MiddlewareHandler } from "astro";

export const onRequest: MiddlewareHandler = async function onRequest(
	{ locals, request },
	next,
) {
	const { url, method } = request;
	const { pathname } = new URL(url);
	const timestamp = new Date().toISOString();

	(locals as { timestamp: string }).timestamp = timestamp;

	console.log(
		`\n\x1b[90m[${timestamp}]\x1b[37m ${method.toUpperCase()} \x1b[33m${pathname}\x1b[37m`,
	);

	const response = await next();

	return response;
};
