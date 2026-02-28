ARG BUILD_FROM
FROM $BUILD_FROM

# Build arguments
ARG BUILD_ARCH
ARG NEOLINK_VERSION="0.6.1"
ARG GO2RTC_VERSION="1.9.7"

# Install system dependencies (non-GStreamer)
RUN apk add --no-cache \
    nodejs \
    npm \
    mosquitto \
    mosquitto-clients \
    curl \
    wget \
    unzip \
    iproute2 \
    bash \
    jq \
    python3 \
    netcat-openbsd \
    busybox-extras \
    gcompat \
    libgcc \
    && rm -rf /var/cache/apk/*

# Install ALL GStreamer packages from Alpine edge in one step.
# gst-rtsp-server is only in edge/community (not in stable 3.19).
# All packages must come from the same version to avoid "symbol not found" errors.
RUN apk add --no-cache \
    -X https://dl-cdn.alpinelinux.org/alpine/edge/main \
    -X https://dl-cdn.alpinelinux.org/alpine/edge/community \
    glib \
    gstreamer \
    gst-plugins-base \
    gst-plugins-good \
    gst-plugins-bad \
    gst-plugins-ugly \
    gst-rtsp-server \
    && rm -rf /var/cache/apk/*

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

# Install go2rtc (arch-specific binary)
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
# Installs to /app to match the working hassio-onvif-server convention.
# Started as: node /app/main.js /data/onvif.yaml
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

# Configure mosquitto for local-only listening
RUN mkdir -p /etc/mosquitto/conf.d \
    && printf 'listener 1883 127.0.0.1\nallow_anonymous true\n' \
       > /etc/mosquitto/conf.d/local.conf \
    && mkdir -p /var/lib/mosquitto \
    && chown mosquitto:mosquitto /var/lib/mosquitto 2>/dev/null || true

# Create data directories
RUN mkdir -p /data/neolink /data/go2rtc /data/logs

WORKDIR /

# Labels
LABEL \
    io.hass.name="Reolink UniFi Protect Bridge" \
    io.hass.description="Connects Reolink cameras to UniFi Protect via ONVIF" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.type="addon" \
    io.hass.version="1.0.5"
