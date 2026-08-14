import { isHTMLBundle } from "./index.mjs";
import { mapResponse } from "./handler.mjs";
const createNativeStaticHandler = (handle, hooks, set) => {
  if (typeof handle == "function" || handle instanceof Blob) return;
  if (isHTMLBundle(handle)) return () => handle;
  const response = mapResponse(
    handle instanceof Response ? handle.clone() : handle instanceof Promise ? handle.then(
      (x) => x instanceof Response ? x.clone() : isHTMLBundle(x) ? () => x : x
    ) : handle,
    set ?? {
      headers: {}
    }
  );
  if (!hooks.parse?.length && !hooks.transform?.length && !hooks.beforeHandle?.length && !hooks.afterHandle?.length)
    return response instanceof Promise ? response.then((response2) => {
      if (response2)
        return response2.clone();
    }) : () => response.clone();
};
export {
  createNativeStaticHandler
};
