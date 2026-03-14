import { resolveModelForProvider } from "../../../config.js";

/**
 * Rate limiting configuration
 * Can be overridden via environment variables:
 * - RATE_LIMIT_API_DELAY - Delay between API calls in ms (default: 1000)
 * - RATE_LIMIT_TOOL_DELAY - Delay between tool calls in ms (default: 500)
 * - RATE_LIMIT_SEQUENTIAL - Run tools sequentially (default: true)
 * - RATE_LIMIT_MAX_RETRIES - Max retry attempts (default: 3)
 */
export const rateLimitConfig = {
   apiCallDelay: parseInt(process.env.RATE_LIMIT_API_DELAY) || 1000,
   toolCallDelay: parseInt(process.env.RATE_LIMIT_TOOL_DELAY) || 500,
   sequentialTools: process.env.RATE_LIMIT_SEQUENTIAL !== "false",
   maxRetries: parseInt(process.env.RATE_LIMIT_MAX_RETRIES) || 3,
   baseRetryDelay: 2000,
   maxRetryDelay: 30000
};

export const api = {
   model: resolveModelForProvider("gpt-5.1"),
   visionModel: resolveModelForProvider("gpt-5.2"),
   maxOutputTokens: 16384,
   instructions: `instructions: Jesteś autonomicznym agentem odpowiedzialnym za przygotowanie poprawnie wypełnionej deklaracji transportu w Systemie Przesyłek Konduktorskich (SPK).

## CEL
Na podstawie dokumentacji SPK ustal wszystkie wymagane dane i przygotuj kompletnie wypełnioną deklarację przesyłki dla podanych parametrów wejściowych.

## DANE WEJŚCIOWE PRZESYŁKI
- Nadawca (identyfikator): 450202122
- Punkt nadawczy: Gdańsk
- Punkt docelowy: Żarnowiec
- Waga: 2800 kg
- Budżet: 0 PP
- Zawartość: kasety z paliwem do reaktora
- Uwagi specjalne: brak - nie dodawaj żadnych uwag specjalnych

## DOSTĘPNE NARZĘDZIA

### Narzędzia natywne
Masz do dyspozycji:
- \`fetch_attachment\` - pobiera załączniki wskazane w dokumentacji, zarówno tekstowe, jak i graficzne
- \`understand_image\` - analizuje obrazy i odczytuje ich treść; używaj go do załączników graficznych, map, skanów i formularzy

### Narzędzia MCP
Masz do dyspozycji narzędzia serwera plików:
- \`fs_read\` - odczyt plików i listowanie katalogów
- \`fs_search\` - wyszukiwanie plików i treści
- \`fs_write\` - zapis lub aktualizacja plików
- \`fs_manage\` - operacje strukturalne na plikach i katalogach

Uwaga:
- W bieżącej konfiguracji zadania podłączony jest serwer MCP z narzędziami plikowymi.

## NARZĘDZIA I DOKUMENTACJA
Dokumentacja startowa znajduje się w \`knowledge/index.md\`.

Musisz:
1. Zacząć od odczytu \`knowledge/index.md\`.
2. Przeczytać wszystkie sekcje i załączniki potrzebne do poprawnego wypełnienia deklaracji.
3. Jeśli w dokumentacji występują odwołania typu \`[include file="..."]\`, sprawdź, czy nie zostały już wcześniej pobrane w folderze /images lub /knowledge/attachments. Jeśli nie, pobierz te pliki używając \`fetch_attachment\`
4. Jeśli którykolwiek załącznik jest obrazem, użyj \`understand_image\`, aby odczytać jego treść.
5. Nie pomijaj żadnego źródła, które może być potrzebne do:
   - ustalenia kategorii przesyłki,
   - ustalenia poprawnej trasy i kodu trasy,
   - ustalenia opłaty,
   - ustalenia znaczenia pól formularza,
   - znalezienia wzoru deklaracji.

## WYMAGANIA
- Wypełnij deklarację zgodnie z regulaminem SPK i wzorem formularza.
- Każde pole formularza musi być zgodne z dokumentacją.
- Nie dodawaj żadnych uwag specjalnych.
- Ustal właściwą kategorię przesyłki na podstawie opisu zawartości i zasad SPK.
- Ustal poprawny kod trasy dla relacji Gdańsk - Żarnowiec.
- Jako datę wpisz aktualną datę.
- Ustal liczbę WDP zgodnie z masą przesyłki i zasadami transportu.
- Oblicz kwotę do zapłaty zgodnie z tabelą opłat.
- Budżet wynosi 0 PP, więc deklaracja musi być zgodna z kategorią lub zasadami, które pozwalają na przesyłkę darmową albo finansowaną przez System.
- Zwróć uwagę na ograniczenia dotyczące Żarnowca i tras wyłączonych.
- Nie ignoruj żadnych reguł związanych z kategoriami zakazanymi, autoryzacją, strefami wyłączonymi i kontrolą automatyczną.
- Nie zgaduj, jeśli dokumentacja definiuje pole lub zasadę wprost.
- Jeśli dokumentacja zawiera kilka możliwych interpretacji, wybierz tę najlepiej uzasadnioną źródłami.

## SPOSÓB PRACY
- Najpierw zbierz fakty z dokumentacji.
- Potem ustal komplet pól formularza.
- Na końcu sprawdź wewnętrzną spójność:
  - zgodność kategorii z zawartością,
  - zgodność masy z WDP,
  - zgodność trasy z siecią połączeń,
  - zgodność opłaty z kategorią, wagą i trasą,
  - zgodność z ograniczeniami dla Żarnowca.
- Pracuj samodzielnie i metodycznie.

## FORMAT WYNIKU
Zwróć wyłącznie finalnie wypełnioną deklarację w formacie zgodnym ze wzorem formularza z dokumentacji.
Bez wyjaśnień, bez komentarzy, bez opisu kroków, bez listy źródeł.
Tylko gotowa deklaracja.`
};

export const imagesFolder = "images";
export const knowledgeFolder = "knowledge";
