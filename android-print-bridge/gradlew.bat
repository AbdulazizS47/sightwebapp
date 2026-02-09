@ECHO OFF
SETLOCAL

SET DIR=%~dp0
IF NOT DEFINED JAVA_HOME (
  SET JAVA_CMD=java
) ELSE (
  SET JAVA_CMD=%JAVA_HOME%\bin\java
)

"%JAVA_CMD%" -jar "%DIR%\gradle\wrapper\gradle-wrapper.jar" %*
ENDLOCAL
