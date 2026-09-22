#include "fh6/net/http_get.hpp"
#include "fh6/log.hpp"
#include "fh6/subprocess.hpp"

#include <windows.h>
#include <winhttp.h>

#include <cstddef>
#include <vector>
#include <algorithm>

#pragma comment(lib, "winhttp.lib")

namespace fh6::net {

std::optional<std::string> http_get(std::string_view url, std::string_view extra_header) {
    std::string full_url = std::string(url);
    
    // trim trailing whitespace/newlines
    while (!full_url.empty() && std::isspace(static_cast<unsigned char>(full_url.back()))) {
        full_url.pop_back();
    }
    if (full_url.empty()) return std::nullopt;
    
    // local paths to absolute paths
    if (full_url[0] == '/') {
        full_url = "http://127.0.0.1:8420" + full_url;
    }

    //log::info("[http] GET '{}'", full_url);

    std::wstring wurl = subprocess::widen(full_url);

    URL_COMPONENTS urlComp = {0};
    urlComp.dwStructSize = sizeof(urlComp);
    
    urlComp.dwHostNameLength = static_cast<DWORD>(-1);
    urlComp.dwUrlPathLength = static_cast<DWORD>(-1);
    urlComp.dwExtraInfoLength = static_cast<DWORD>(-1);

    if (!WinHttpCrackUrl(wurl.c_str(), 0, 0, &urlComp)) {
        log::error("[http] WinHttpCrackUrl failed for {}", full_url);
        return std::nullopt;
    }

    std::wstring hostName;
    if (urlComp.dwHostNameLength > 0 && urlComp.lpszHostName) {
        hostName.assign(urlComp.lpszHostName, urlComp.dwHostNameLength);
    }

    std::wstring requestTarget;
    if (urlComp.dwUrlPathLength > 0 && urlComp.lpszUrlPath) {
        requestTarget.assign(urlComp.lpszUrlPath, urlComp.dwUrlPathLength);
    } else {
        requestTarget = L"/";
    }
    if (urlComp.dwExtraInfoLength > 0 && urlComp.lpszExtraInfo) {
        requestTarget.append(urlComp.lpszExtraInfo, urlComp.dwExtraInfoLength);
    }

    HINTERNET hSession = WinHttpOpen(L"FH6 Universal Radio/1.0", 
                                     WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                     WINHTTP_NO_PROXY_NAME, 
                                     WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) {
        log::error("[http] WinHttpOpen failed");
        return std::nullopt;
    }

    if (!WinHttpSetTimeouts(hSession, 5000, 10000, 10000, 15000)) {
        log::warn("[http] WinHttpSetTimeouts failed");
    }

    struct SessionGuard {
        HINTERNET h;
        ~SessionGuard() { if (h) WinHttpCloseHandle(h); }
    } sg{hSession};

    HINTERNET hConnect = WinHttpConnect(hSession, hostName.c_str(), urlComp.nPort, 0);
    if (!hConnect) {
        log::error("[http] WinHttpConnect failed to host");
        return std::nullopt;
    }
    SessionGuard cg{hConnect};

    DWORD flags = (urlComp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"GET", requestTarget.c_str(),
                                            nullptr, WINHTTP_NO_REFERER,
                                            WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!hRequest) {
        log::error("[http] WinHttpOpenRequest failed");
        return std::nullopt;
    }
    SessionGuard rg{hRequest};

    std::wstring wheaders;
    if (!extra_header.empty()) {
        wheaders = subprocess::widen(std::string(extra_header));
    }

    if (!WinHttpSendRequest(hRequest, 
                            wheaders.empty() ? WINHTTP_NO_ADDITIONAL_HEADERS : wheaders.c_str(),
                            wheaders.empty() ? 0 : -1,
                            WINHTTP_NO_REQUEST_DATA, 0, 0, 0)) {
        log::error("[http] WinHttpSendRequest failed");
        return std::nullopt;
    }

    if (!WinHttpReceiveResponse(hRequest, nullptr)) {
        log::error("[http] WinHttpReceiveResponse failed");
        return std::nullopt;
    }

    // verify status code is 200
    DWORD statusCode = 0;
    DWORD dwSize = sizeof(statusCode);
    WinHttpQueryHeaders(hRequest, 
                        WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, 
                        WINHTTP_HEADER_NAME_BY_INDEX, 
                        &statusCode, &dwSize, WINHTTP_NO_HEADER_INDEX);

    if (statusCode != 200) {
        log::error("[http] Non-200 HTTP Response ({}): {}", statusCode, full_url);
        return std::nullopt;
    }

    constexpr std::size_t kMaxHttpBodyBytes = 10 * 1024 * 1024;
    std::string body;
    DWORD dwDownloaded = 0;
    do {
        DWORD dwAvailable = 0;
        if (!WinHttpQueryDataAvailable(hRequest, &dwAvailable)) {
            log::error("[http] WinHttpQueryDataAvailable failed");
            return std::nullopt;
        }
        if (dwAvailable == 0) break;
        if (dwAvailable > kMaxHttpBodyBytes - body.size()) {
            log::error("[http] response exceeded maximum download size");
            return std::nullopt;
        }

        std::vector<char> buffer(dwAvailable);
        if (!WinHttpReadData(hRequest, buffer.data(), dwAvailable, &dwDownloaded)) {
            log::error("[http] WinHttpReadData failed");
            return std::nullopt;
        }
        body.append(buffer.data(), dwDownloaded);
    } while (dwDownloaded > 0);

    return body;
}

std::optional<std::string> http_post(std::string_view url, std::string_view json_body,
                                     const std::vector<std::string>& extra_headers) {
    std::wstring wurl = subprocess::widen(std::string(url));

    URL_COMPONENTS urlComp = {0};
    urlComp.dwStructSize = sizeof(urlComp);
    urlComp.dwHostNameLength = static_cast<DWORD>(-1);
    urlComp.dwUrlPathLength = static_cast<DWORD>(-1);
    urlComp.dwExtraInfoLength = static_cast<DWORD>(-1);

    if (!WinHttpCrackUrl(wurl.c_str(), 0, 0, &urlComp)) {
        log::error("[http] WinHttpCrackUrl failed for POST {}", std::string(url));
        return std::nullopt;
    }

    std::wstring hostName{urlComp.lpszHostName, urlComp.dwHostNameLength};
    std::wstring requestTarget{urlComp.lpszUrlPath, urlComp.dwUrlPathLength};
    if (urlComp.dwExtraInfoLength > 0 && urlComp.lpszExtraInfo)
        requestTarget.append(urlComp.lpszExtraInfo, urlComp.dwExtraInfoLength);
    if (requestTarget.empty()) requestTarget = L"/";

    HINTERNET hSession = WinHttpOpen(L"FH6 Universal Radio/1.0",
                                     WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                     WINHTTP_NO_PROXY_NAME,
                                     WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) {
        log::error("[http] WinHttpOpen failed (POST)");
        return std::nullopt;
    }
    WinHttpSetTimeouts(hSession, 5000, 10000, 10000, 15000);

    struct SessionGuard {
        HINTERNET h;
        ~SessionGuard() { if (h) WinHttpCloseHandle(h); }
    } sg{hSession};

    HINTERNET hConnect = WinHttpConnect(hSession, hostName.c_str(), urlComp.nPort, 0);
    if (!hConnect) {
        log::error("[http] WinHttpConnect failed (POST)");
        return std::nullopt;
    }
    SessionGuard cg{hConnect};

    DWORD flags = (urlComp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"POST", requestTarget.c_str(),
                                            nullptr, WINHTTP_NO_REFERER,
                                            WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!hRequest) {
        log::error("[http] WinHttpOpenRequest failed (POST)");
        return std::nullopt;
    }
    SessionGuard rg{hRequest};

    std::wstring headers = L"Content-Type: application/json\r\n";
    for (const auto& h : extra_headers) {
        headers += subprocess::widen(h);
        headers += L"\r\n";
    }

    std::string body{json_body};
    if (!WinHttpSendRequest(hRequest, headers.c_str(), static_cast<DWORD>(-1),
                            body.empty() ? WINHTTP_NO_REQUEST_DATA : body.data(),
                            static_cast<DWORD>(body.size()), static_cast<DWORD>(body.size()), 0)) {
        log::error("[http] WinHttpSendRequest failed (POST)");
        return std::nullopt;
    }

    if (!WinHttpReceiveResponse(hRequest, nullptr)) {
        log::error("[http] WinHttpReceiveResponse failed (POST)");
        return std::nullopt;
    }

    DWORD statusCode = 0, dwSize = sizeof(statusCode);
    WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &dwSize, WINHTTP_NO_HEADER_INDEX);
    if (statusCode < 200 || statusCode >= 300) {
        log::error("[http] Non-2xx HTTP Response ({}) for POST {}", statusCode, std::string(url));
        return std::nullopt;
    }

    constexpr std::size_t kMaxHttpBodyBytes = 10 * 1024 * 1024;
    std::string responseBody;
    DWORD dwDownloaded = 0;
    do {
        DWORD dwAvailable = 0;
        if (!WinHttpQueryDataAvailable(hRequest, &dwAvailable)) {
            log::error("[http] WinHttpQueryDataAvailable failed (POST)");
            return std::nullopt;
        }
        if (dwAvailable == 0) break;
        if (dwAvailable > kMaxHttpBodyBytes - responseBody.size()) {
            log::error("[http] POST response exceeded maximum download size");
            return std::nullopt;
        }
        std::vector<char> buffer(dwAvailable);
        if (!WinHttpReadData(hRequest, buffer.data(), dwAvailable, &dwDownloaded)) {
            log::error("[http] WinHttpReadData failed (POST)");
            return std::nullopt;
        }
        responseBody.append(buffer.data(), dwDownloaded);
    } while (dwDownloaded > 0);

    return responseBody;
}

} // namespace fh6::net
