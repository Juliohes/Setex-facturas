FROM nginx:1.25-alpine
COPY src/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
HEALTHCHECK CMD wget --quiet --tries=1 --spider http://localhost:80/ || exit 1
