#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace fh6::net {

// Blocking in-memory HTTP(S) GET. Body on HTTP 200, else nullopt. 5 s timeouts.
// extra_header is an optional raw header line (e.g. "Authorization: ...").
std::optional<std::string> http_get(std::string_view url, std::string_view extra_header = {});

// Status code plus body of a completed HTTP(S) exchange. `status` is 0 when
// the request never got a response at all (DNS/connect/timeout/etc, as
// opposed to a non-2xx HTTP status, which IS a completed exchange); `body`
// is present whenever a response body was actually read, regardless of
// status, so callers can inspect an error response's body (e.g. Innertube's
// 401/403 JSON error payload) instead of only ever seeing success or nothing.
struct HttpPostResult {
    int status = 0;
    std::optional<std::string> body;
};

// Blocking in-memory HTTP(S) POST with a JSON body. 5 s timeouts.
// extra_headers are raw header lines (e.g.
// "Cookie: name=value; name2=value2"), sent in addition to
// "Content-Type: application/json", which this always sets itself.
HttpPostResult http_post(std::string_view url, std::string_view json_body,
                         const std::vector<std::string>& extra_headers = {});

} // namespace fh6::net
