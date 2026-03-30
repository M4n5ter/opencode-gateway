use std::error::Error;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

pub(crate) struct HttpResponse {
    pub(crate) status_code: u16,
    pub(crate) body: String,
}

pub(crate) fn http_get(host: &str, port: u16, path: &str) -> Result<HttpResponse, Box<dyn Error>> {
    let mut stream = TcpStream::connect((host, port))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n"
    )?;
    stream.flush()?;

    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    parse_http_response(&response)
}

pub(crate) fn percent_encode(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len());

    for byte in bytes {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(char::from(*byte));
            }
            _ => {
                encoded.push('%');
                encoded.push_str(&format!("{byte:02X}"));
            }
        }
    }

    encoded
}

fn parse_http_response(response: &str) -> Result<HttpResponse, Box<dyn Error>> {
    let (head, body) = response
        .split_once("\r\n\r\n")
        .or_else(|| response.split_once("\n\n"))
        .ok_or("invalid HTTP response")?;
    let status_line = head.lines().next().ok_or("missing HTTP status line")?;
    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .ok_or("missing HTTP status code")?
        .parse::<u16>()?;

    Ok(HttpResponse {
        status_code,
        body: body.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::parse_http_response;

    #[test]
    fn parse_http_response_extracts_status_and_body() {
        let response = parse_http_response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}",
        )
        .expect("response should parse");

        assert_eq!(response.status_code, 200);
        assert_eq!(response.body, "{\"ok\":true}");
    }
}
