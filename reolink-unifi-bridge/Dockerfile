ARG BUILD_FROM
FROM $BUILD_FROM

# Build arguments
ARG BUILD_ARCH
ARG NEOLINK_VERSION="0.6.1"
ARG GO2RTC_VERSION="1.9.7"

# Install system dependencies.
# Debian base is required: neolink is a glibc binary (compiled for Debian Bullseye)
# and needs glibc-linked GStreamer libraries. Alpine's musl-compiled GStreamer
# causes "symbol not found" ABI errors that cannot be worked around with gcompat.
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs \
    npm \
    curl \
    wget \
    unzip \
    iproute2 \
    bash \
    jq \
    python3 \
    netcat-openbsd \
    udhcpc \
    libgstreamer1.0-0 \
    libgstreamer-plugins-base1.0-0 \
    libgstreamer-plugins-bad1.0-0 \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-libav \
    libgstrtspserver-1.0-0 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Neolink (arch-specific binary)
RUN \
    if [ "${BUILD_ARCH}" = "amd64" ]; then NEOLINK_FILE="neolink_linux_x86_64_bullseye"; \
    elif [ "${BUILD_ARCH}" = "aarch64" ]; then NEOLINK_FILE="neolink_linux_arm64"; \
    elif [ "${BUILD_ARCH}" = "armhf" ]; then NEOLINK_FILE="neolink_linux_armhf"; \
    elif [ "${BUILD_ARCH}" = "armv7" ]; then NEOLINK_FILE="neolink_linux_armhf"; \
    else echo "Unsupported arch: ${BUILD_ARCH}" && exit 1; fi \
    && wget -q "https://github.com/QuantumEntangledAndy/neolink/releases/download/v${NEOLINK_VERSION}/${NEOLINK_FILE}.zip" \
       -O /tmp/neolink.zip \
    && [ -s /tmp/neolink.zip ] \
    && unzip /tmp/neolink.zip -d /tmp/neolink_extract \
    && find /tmp/neolink_extract -name "neolink" -type f -exec cp {} /usr/local/bin/neolink \; \
    && chmod +x /usr/local/bin/neolink \
    && rm -rf /tmp/neolink.zip /tmp/neolink_extract

# Install go2rtc (arch-specific binary, statically linked Go — works on any Linux)
RUN \
    if [ "${BUILD_ARCH}" = "amd64" ]; then GO2RTC_ARCH="amd64"; \
    elif [ "${BUILD_ARCH}" = "aarch64" ]; then GO2RTC_ARCH="arm64"; \
    elif [ "${BUILD_ARCH}" = "armhf" ]; then GO2RTC_ARCH="arm"; \
    elif [ "${BUILD_ARCH}" = "armv7" ]; then GO2RTC_ARCH="arm"; \
    else echo "Unsupported arch: ${BUILD_ARCH}" && exit 1; fi \
    && wget -q "https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/go2rtc_linux_${GO2RTC_ARCH}" \
       -O /usr/local/bin/go2rtc \
    && chmod +x /usr/local/bin/go2rtc

# Install ONVIF Server (daniela-hase/onvif-server)
# Installs to /app. Started as: node /app/main.js /data/onvif.yaml
RUN mkdir -p /app
WORKDIR /app
RUN wget -q "https://github.com/daniela-hase/onvif-server/archive/refs/heads/main.tar.gz" \
       -O - | tar xz --strip-components=1 \
    && npm install --production --silent \
    && npm cache clean --force

# Install Dashboard dependencies
COPY rootfs/opt/dashboard/package.json /opt/dashboard/package.json
WORKDIR /opt/dashboard
RUN npm install --production --silent \
    && npm cache clean --force

# Copy dashboard source files
COPY rootfs/opt/dashboard /opt/dashboard

# Copy full rootfs overlay
COPY rootfs /

# Make all scripts executable
RUN find /etc/cont-init.d -name "*.sh" -exec chmod +x {} \; \
    && find /etc/services.d -name "run" -exec chmod +x {} \; \
    && find /etc/services.d -name "finish" -exec chmod +x {} \; \
    && chmod +x /usr/bin/wait-for-port \
    && chmod +x /usr/bin/udhcpc-onvif-script

# Create data directories
RUN mkdir -p /data/neolink /data/go2rtc /data/logs

WORKDIR /

# Labels
LABEL \
    io.hass.name="Reolink UniFi Protect Bridge" \
    io.hass.description="Connects Reolink cameras to UniFi Protect via ONVIF" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.type="addon" \
    io.hass.version="1.0.12"
