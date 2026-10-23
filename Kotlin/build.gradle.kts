plugins {
    kotlin("jvm") version "2.2.20"
}

group = "ua.upc"
version = "0.1.0"

repositories {
    mavenCentral()
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
}
