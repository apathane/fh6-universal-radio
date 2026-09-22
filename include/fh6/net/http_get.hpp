#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace fh6::net {

// Blocking in-memory HTTP(S) GET. Body on HTTP 200, else nullopt. 5 s timeouts.
// extra_header is an optional raw header line (e.g. "Authorization: ...").
std::optional<std::string> http_get(std::string_view url, std::string_view extra_header = {});

// Blocking in-memory HTTP(S) POST with a JSON body. Body on 2xx, else
// nullopt. 5 s timeouts. extra_headers are raw header lines (e.g.
// "Cookie: name=value; name2=value2"), sent in addition to
// "Content-Type: application/json", which this always sets itself.
std::optional<std::string> http_post(std::string_view url, std::string_view json_body,
                                     const std::vector<std::string>& extra_headers = {});

} // namespace fh6::net
