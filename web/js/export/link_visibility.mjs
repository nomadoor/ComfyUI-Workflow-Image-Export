function createEmptyLinksLike(links) {
  if (links instanceof Map) return new Map();
  if (links instanceof Set) return new Set();
  if (Array.isArray(links)) return [];
  if (links && typeof links === "object") return {};
  return links;
}

function createEmptyLinkListLike(links) {
  if (links instanceof Set) return new Set();
  return [];
}

function getGraphNodes(graph) {
  const seen = new Set();
  const nodes = [];
  const add = (node) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    nodes.push(node);
  };

  if (Array.isArray(graph?._nodes)) {
    graph._nodes.forEach(add);
  }
  if (Array.isArray(graph?.nodes)) {
    graph.nodes.forEach(add);
  } else if (graph?.nodes instanceof Map) {
    graph.nodes.forEach(add);
  } else if (graph?.nodes && typeof graph.nodes === "object") {
    Object.values(graph.nodes).forEach(add);
  }

  return nodes;
}

function getLinkIdSet(links) {
  if (links instanceof Map) {
    return new Set([...links.keys()].map((id) => Number(id)).filter(Number.isFinite));
  }
  if (Array.isArray(links)) {
    return new Set(
      links
        .map((link, index) => Number(link?.id ?? link?.[0] ?? index))
        .filter(Number.isFinite)
    );
  }
  if (links && typeof links === "object") {
    return new Set(Object.keys(links).map((id) => Number(id)).filter(Number.isFinite));
  }
  return new Set();
}

function linkListToArray(value) {
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return value;
  return [];
}

export function detachNodeLinkRefs(graph, keepIds = null) {
  const restoreEntries = [];
  const shouldKeep = (id) => {
    if (!keepIds) return false;
    const num = Number(id);
    return Number.isFinite(num) && keepIds.has(num);
  };

  for (const node of getGraphNodes(graph)) {
    if (Array.isArray(node.inputs)) {
      for (const input of node.inputs) {
        if (!input || typeof input !== "object" || !("link" in input)) continue;
        const prev = input.link;
        if (shouldKeep(prev)) continue;
        restoreEntries.push({ target: input, key: "link", value: prev });
        input.link = null;
      }
    }

    if (Array.isArray(node.outputs)) {
      for (const output of node.outputs) {
        if (!output || typeof output !== "object") continue;
        if ("links" in output) {
          const prev = output.links;
          const kept = linkListToArray(prev).filter(shouldKeep);
          if (kept.length === linkListToArray(prev).length) continue;
          restoreEntries.push({ target: output, key: "links", value: prev });
          output.links = keepIds ? kept : createEmptyLinkListLike(prev);
        }
        if ("link" in output) {
          const prev = output.link;
          if (shouldKeep(prev)) continue;
          restoreEntries.push({ target: output, key: "link", value: prev });
          output.link = null;
        }
      }
    }
  }

  return () => {
    for (let i = restoreEntries.length - 1; i >= 0; i -= 1) {
      const entry = restoreEntries[i];
      entry.target[entry.key] = entry.value;
    }
  };
}

export function hideGraphLinks(graph) {
  const restoreFns = [];
  if (graph && "links" in graph) {
    const originalLinks = graph.links;
    graph.links = createEmptyLinksLike(originalLinks);
    restoreFns.push(() => {
      graph.links = originalLinks;
    });
  }
  restoreFns.push(detachNodeLinkRefs(graph));

  return () => {
    for (let i = restoreFns.length - 1; i >= 0; i -= 1) {
      restoreFns[i]();
    }
  };
}

export function syncNodeLinkRefsToGraphLinks(graph) {
  return detachNodeLinkRefs(graph, getLinkIdSet(graph?.links));
}
