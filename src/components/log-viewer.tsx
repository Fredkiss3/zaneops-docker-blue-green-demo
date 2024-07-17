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

export function LogViewerContent() {
    const logScrollTopRef = React.useRef<React.ElementRef<"div">>(null);
    const logScrollBottomRef = React.useRef<React.ElementRef<"div">>(null);
    const [searchValue, setSearchValue] = React.useState("");
    const [dateStart, setDateStart] = React.useState<Date | null>(null);
    const [dateEnd, setDateEnd] = React.useState<Date | null>(null);
    const queryClient = useQueryClient();

    const { data, fetchNextPage, hasNextPage, isFetching, isRefetching } =
        useInfiniteQuery<
            LogsApiResponse,
            Error,
            InfiniteData<LogsApiResponse>,
            QueryKey,
            string | null
        >({
            queryKey: [
                "logs",
                searchValue,
                dateEnd?.toISOString(),
                dateStart?.toISOString(),
            ] as const,
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

                const allData = queryClient.getQueryData([
                    "logs",
                    searchValue,
                ]) as InfiniteData<LogsApiResponse, string | null>;

                const existingData = allData?.pages.find(
                    (_, index) => allData?.pageParams[index] === pageParam
                );

                if (existingData && existingData.previous) {
                    // console.log(`Reusing data (cursor: ${pageParam})`);
                    return existingData;
                }
                if (existingData?.cursor) {
                    searchParams.set("cursor", existingData.cursor);
                }

                // console.log(
                //     `Fetching data with cursor : ${searchParams.get("cursor")}`
                // );

                const data = await fetch(
                    `/api/logs?${searchParams.toString()}`,
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
                        `/api/logs?${searchParams.toString()}`,
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
                            onChange={(e) =>
                                setDateStart(new Date(e.currentTarget.value))
                            }
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
                            onChange={(e) =>
                                setDateEnd(new Date(e.currentTarget.value))
                            }
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
                                : log.content}
                        </div>
                    ))}
                    <div className="w-full py-3" ref={logScrollBottomRef} />
                </pre>
            </div>
        </div>
    );
}
