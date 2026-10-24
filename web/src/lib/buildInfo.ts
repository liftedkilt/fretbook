/** The Node that built this bundle ("" when unknown). The server container has no Node at runtime. */
export const nodeVersion: string = typeof __NODE_VERSION__ === "string" ? __NODE_VERSION__ : "";
