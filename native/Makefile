CFLAGS ?= -O2 -std=c11 -Wall -Wextra -Werror

jigsaw2pdf: jigsaw2pdf.c
	$(CC) $(CFLAGS) -o $@ $<

test: jigsaw2pdf
	node test/run.ts

clean:
	rm -f jigsaw2pdf

.PHONY: test clean
