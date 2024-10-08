import * as React from "react";
import {
    keepPreviousData,
    QueryClient,
    QueryClientProvider,
    useInfiniteQuery,
    useQueryClient,
    type InfiniteData,
    type QueryKey,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { z } from "zod";

const resultSchema = z.object({
    id: z.string().uuid(),
    content: z.string(),
    time: z.string().datetime(),
    level: z.enum(["INFO", "ERROR"]),
    deployment_id: z.string(),
    service_id: z.string(),
    source: z.string(),
});

const logsSchema = z.object({
    next: z
        .string()
        .url()
        .nullable()
        .transform((url) => {
            return !url ? null : new URL(url).searchParams.get("cursor");
        }),
    previous: z
        .string()
        .url()
        .nullable()
        .transform((url) => {
            return !url ? null : new URL(url).searchParams.get("cursor");
        }),
    results: z.array(resultSchema),
    cursor: z.string().nullish(),
});
type LogsApiResponse = z.TypeOf<typeof logsSchema>;

export function LogViewer() {
    const [queryClient] = React.useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        refetchOnWindowFocus: false,
                    },
                },
            })
    );
    return (
        <QueryClientProvider client={queryClient}>
            <LogViewerContent />
            <ReactQueryDevtools />
        </QueryClientProvider>
    );
}

function isScrolledIntoView(el: HTMLElement | null): boolean {
    if (!el) return false;

    const rect = el.getBoundingClientRect();
    const elemTop = rect.top;
    const elemBottom = rect.bottom;

    // Only completely visible elements return true:
    // const isVisible = elemTop >= 0 && elemBottom <= window.innerHeight;
    // Partially visible elements return true:
    const isVisible = elemTop < window.innerHeight && elemBottom >= 0;
    return isVisible;
}

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

function getHighlightedText(text: string, highlight: string) {
    // Split on highlight term and include term into parts, ignore case
    const parts = text.split(new RegExp(`(${escapeRegExp(highlight)})`, "gi"));
    return (
        <span className="">
            {parts.map((part, i) => (
                <span
                    key={i}
                    className={
                        part.toLowerCase() === highlight.toLowerCase()
                            ? "bg-yellow-200/40"
                            : ""
                    }
                >
                    {part}
                </span>
            ))}
        </span>
    );
}

function isValidDate(d: any) {
    // @ts-expect-error invalid date is NaN but TS complains for some reason
    return d instanceof Date && !isNaN(d);
}

function colorLogs(text: string) {
    const ansiStyles: Record<string, string> = {
        "\u001b[92m": "text-green-500",
        "\u001b[94m": "text-blue-500",
        "\u001b[93m": "text-yellow-500",
        "\u001b[91m": "text-red-500",
        "\u001b[0m": "", // Reset to default color
    };

    Object.keys(ansiStyles).forEach((ansiCode) => {
        const safeAnsiCode = escapeRegExp(ansiCode);
        const tailwindClass = ansiStyles[ansiCode];

        // Replace ANSI code with the corresponding styled span tag and close any open span before it
        text = text.replace(
            new RegExp(safeAnsiCode, "g"),
            (match, offset, string) => {
                if (tailwindClass) {
                    return `</span><span class="${tailwindClass}">`;
                } else {
                    return "</span>";
                }
            }
        );
    });

    // Ensure all opened <span> tags are closed by removing any leading </span> tags
    text = text.replace(/^<\/span>/, "");

    return <span dangerouslySetInnerHTML={{ __html: text }} />;
}

export function LogViewerContent() {
    const logScrollTopRef = React.useRef<React.ElementRef<"div">>(null);
    const logScrollBottomRef = React.useRef<React.ElementRef<"div">>(null);
    const [searchValue, setSearchValue] = React.useState("");
    const [dateStart, setDateStart] = React.useState<Date | null>(null);
    const [dateEnd, setDateEnd] = React.useState<Date | null>(null);
    const queryClient = useQueryClient();
    const [deploymentId, setDeploymentId] = React.useState("");
    const [serviceSlug, setServiceSlug] = React.useState("nginx-demo");

    const queryKey = [
        "logs",
        serviceSlug,
        deploymentId,
        searchValue,
        dateEnd?.toISOString(),
        dateStart?.toISOString(),
    ] as const;

    const { data, fetchNextPage, hasNextPage, isFetching, isRefetching } =
        useInfiniteQuery<
            LogsApiResponse,
            Error,
            InfiniteData<LogsApiResponse>,
            QueryKey,
            string | null
        >({
            queryKey,
            enabled: Boolean(serviceSlug) && Boolean(deploymentId),
            queryFn: async ({ pageParam, signal }) => {
                const searchParams = new URLSearchParams();
                if (pageParam) {
                    searchParams.append("cursor", pageParam);
                }
                if (searchValue.trim()) {
                    searchParams.append("content", searchValue);
                }
                if (dateStart) {
                    searchParams.append("time_after", dateStart.toISOString());
                }
                if (dateEnd) {
                    searchParams.append("time_before", dateEnd.toISOString());
                }

                const allData = queryClient.getQueryData(
                    queryKey
                ) as InfiniteData<LogsApiResponse, string | null>;

                const existingData = allData?.pages.find(
                    (_, index) => allData?.pageParams[index] === pageParam
                );

                /**
                 * We reuse the data in the query as we are sure this page is immutable,
                 * And we don't want to refetch the same logs that we have already fetched.
                 *
                 * However if we have the data in the cache and previous is `null`,
                 * it means that that page is the last and the next time we fetch it,
                 * it might have more data.
                 * Inspired by: https://github.com/TanStack/query/discussions/5921
                 */
                if (existingData && existingData.previous) {
                    return existingData;
                }
                if (existingData?.cursor) {
                    searchParams.set("cursor", existingData.cursor);
                }

                const data = await fetch(
                    `/api/${serviceSlug}/${deploymentId}/logs?${searchParams.toString()}`,
                    {
                        signal,
                        credentials: "include",
                    }
                )
                    .then((r) => r.json())
                    .then((r) => logsSchema.parse(r))
                    .then((data) => ({
                        ...data,
                        cursor: existingData?.cursor,
                    }));

                // get cursor for initial page as its pageParam is `null`
                // we want to do so that we don't to always fetch the latest data for the initial page
                // instead what we want is to fetch from the data it starts
                if (pageParam === null && data.next !== null && !data.cursor) {
                    searchParams.set("cursor", data.next);
                    const nextPage = await fetch(
                        `/api/${serviceSlug}/${deploymentId}/logs?${searchParams.toString()}`,
                        {
                            signal,
                            credentials: "include",
                        }
                    )
                        .then((r) => r.json())
                        .then((r) => logsSchema.parse(r));

                    data.cursor = nextPage.previous;
                }

                return {
                    ...data,
                    results: data.results.toReversed(),
                };
            },
            // we use the inverse of the cursors we get from the API
            // because the API order them by time but in descending order,
            // so the next page is actually the oldest,
            // we flip it here because we want to keep it consistent with our UI
            getNextPageParam: ({ previous }) => previous,
            getPreviousPageParam: ({ next }) => next,
            initialPageParam: null,
            placeholderData: keepPreviousData,
            staleTime: Infinity,
            refetchInterval(query) {
                const FIVE_SECONDS = 5 * 1000;
                if (query.state.data) {
                    return FIVE_SECONDS;
                }
                return false;
            },
        });

    const logsToRender = React.useMemo(() => {
        return (
            data?.pages
                .flat()
                .map((item) => item.results)
                .flat() ?? []
        );
    }, [data]);

    React.useEffect(() => {
        if (hasNextPage && !isRefetching && !isFetching) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetching, isRefetching]);

    React.useLayoutEffect(() => {
        // whenever we get new data, and we were in the end position,
        // we scroll back to it, to tail the data
        if (isScrolledIntoView(logScrollBottomRef.current)) {
            logScrollBottomRef.current?.scrollIntoView({
                behavior: "instant",
                block: "end",
            });
        }
    }, [data]);

    return (
        <div className="container mx-auto px-4 pb-14 pt-5 flex flex-col gap-4">
            <div className="flex flex-col gap-4 items-start">
                <h1 className="text-2xl font-bold mb-4">Log Stream</h1>
                <fieldset className="flex flex-col gap-2">
                    <div>
                        <label
                            htmlFor="dateStart"
                            className="inline-block w-40"
                        >
                            Starting from :
                        </label>
                        <input
                            type="datetime-local"
                            id="dateStart"
                            className="border-gray-600 rounded-md px-2 py-2 bg-gray-950  text-white"
                            onChange={(e) => {
                                const datStrt = new Date(e.currentTarget.value);
                                if (isValidDate(datStrt)) {
                                    setDateStart(datStrt);
                                }
                            }}
                        />
                    </div>
                    <div>
                        <label htmlFor="dateEnd" className="inline-block w-40">
                            Until :
                        </label>
                        <input
                            type="datetime-local"
                            id="dateEnd"
                            className="border-gray-600  rounded-md px-2 py-2 bg-gray-950 text-white"
                            onChange={(e) => {
                                const datEnd = new Date(e.currentTarget.value);
                                if (isValidDate(datEnd)) {
                                    setDateEnd(datEnd);
                                }
                            }}
                        />
                    </div>

                    <div>
                        <label htmlFor="query" className="inline-block w-40">
                            Query :
                        </label>
                        <input
                            placeholder="filter logs"
                            id="query"
                            className="border border-gray-600 px-4 py-2 rounded-md bg-gray-950"
                            onChange={(e) =>
                                setSearchValue(e.currentTarget.value)
                            }
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="service-slug"
                            className="inline-block w-40"
                        >
                            Service Slug :
                        </label>
                        <input
                            placeholder=""
                            id="service-slug"
                            defaultValue={serviceSlug}
                            className="border border-gray-600 px-4 py-2 rounded-md bg-gray-950"
                            onChange={(e) =>
                                setServiceSlug(e.currentTarget.value.trim())
                            }
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="deployment-id"
                            className="inline-block w-40"
                        >
                            Deployment Id :
                        </label>
                        <input
                            placeholder=""
                            id="deployment-id"
                            className="border border-gray-600 px-4 py-2 rounded-md bg-gray-950"
                            onChange={(e) =>
                                setDeploymentId(e.currentTarget.value.trim())
                            }
                        />
                    </div>
                </fieldset>
            </div>

            <div className="bg-gray-950 rounded-lg px-4 pb-2 h-[65vh] overflow-y-auto">
                <pre
                    id="logContent"
                    className="text-base whitespace-no-wrap overflow-x-scroll [font-family:GeistMono]"
                >
                    <div className="w-full py-3" ref={logScrollTopRef} />
                    {data && logsToRender.length === 0 && (
                        <span className="italic text-gray-500">
                            {!!searchValue ? (
                                <>No logs matching filter `{searchValue}`</>
                            ) : (
                                <>No logs yets</>
                            )}
                        </span>
                    )}
                    {logsToRender.map((log) => (
                        <div key={log.id} className="flex gap-2">
                            <span
                                className={
                                    log.level === "INFO"
                                        ? "text-blue-400"
                                        : "text-red-400"
                                }
                            >
                                [{new Date(log.time).toLocaleString()}]
                            </span>
                            {!!searchValue
                                ? getHighlightedText(log.content, searchValue)
                                : colorLogs(log.content)}
                        </div>
                    ))}
                    <div className="w-full py-3" ref={logScrollBottomRef} />
                </pre>
            </div>
        </div>
    );
}
