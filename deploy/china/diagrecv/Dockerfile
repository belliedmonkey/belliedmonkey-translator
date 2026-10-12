FROM golang:1.23-alpine AS b
WORKDIR /src
COPY main.go .
RUN CGO_ENABLED=0 go build -o /diagrecv .
FROM alpine:3.20
COPY --from=b /diagrecv /diagrecv
CMD ["/diagrecv"]
