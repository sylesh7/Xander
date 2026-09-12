import Header from '@/components/Header'
import Wire from '@/components/Wire'
import SmallBands from '@/components/SmallBands'
import ServicesTeaser from '@/components/ServicesTeaser'
import RescueTeaser from '@/components/RescueTeaser'
import Work from '@/components/Work'
import AboutTeaser from '@/components/AboutTeaser'
import FieldNotes from '@/components/FieldNotes'
import ShopClass from '@/components/ShopClass'
import NowBooking from '@/components/NowBooking'
import Contact from '@/components/Contact'
import Footer from '@/components/Footer'

export default function Home() {
  return (
    <>
      <Header />
      <main id="main">
        <Wire />
        <SmallBands />
        <ServicesTeaser />
        <RescueTeaser />
        <Work />
        <AboutTeaser />
        <FieldNotes />
        <ShopClass />
        <NowBooking />
        <Contact />
      </main>
      <Footer />
    </>
  )
}
