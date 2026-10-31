# Bitcoin Core from the official release, verified against its SHA256SUMS.
# Used only as a private regtest chain in tests.
FROM debian:trixie-slim
ARG BITCOIN_VERSION=32.1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      arm64) plat=aarch64-linux-gnu ;; amd64) plat=x86_64-linux-gnu ;; \
      *) echo "unsupported arch" >&2; exit 1 ;; \
    esac; \
    base="https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}"; \
    file="bitcoin-${BITCOIN_VERSION}-${plat}.tar.gz"; \
    cd /tmp; \
    curl -fsSLO "${base}/${file}"; \
    curl -fsSLO "${base}/SHA256SUMS"; \
    grep " ${file}\$" SHA256SUMS | sha256sum -c -; \
    tar -xzf "${file}"; \
    install -m 0755 "bitcoin-${BITCOIN_VERSION}/bin/bitcoind" "bitcoin-${BITCOIN_VERSION}/bin/bitcoin-cli" /usr/local/bin/; \
    rm -rf /tmp/*
RUN useradd -m bitcoin
USER bitcoin
ENTRYPOINT ["bitcoind"]
